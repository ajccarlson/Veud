#!/usr/bin/env node
import 'dotenv/config'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import { listRequiredMigrations } from './backup-utils.mjs'
import {
	assertPostgresDatabaseUrl,
	buildModelTransferPlan,
	containsOnlyMigrationSeededReferenceRows,
	convertSqliteRow,
	postgresTargetIdentity,
	sortRowsForSelfRelations,
} from './postgres-transfer-utils.mjs'

const implicitJoinTables = ['_PermissionToRole', '_RoleToUser']
const args = process.argv.slice(2)
const usage = `Usage: npm run db:transfer:postgres -- --source SNAPSHOT [options]

Options:
  --source PATH       Verified, immutable SQLite snapshot (required)
  --commit            Write to PostgreSQL (default: inventory-only dry-run)
  --resume            Resume an interrupted transfer into a non-empty target
  --checkpoint PATH   Transfer identity/progress file (default: beside snapshot)
  --batch-size N      Rows per PostgreSQL createMany call (default: 250)
  --help              Show this help

Commit mode requires a PostgreSQL DATABASE_URL and a PostgreSQL-generated Prisma
client. The destination must be empty unless --resume is explicit.`

function valueFor(flag) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a value`)
	return value
}

function positiveInteger(flag, fallback) {
	const raw = valueFor(flag)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
		throw new Error(`${flag} must be an integer from 1 through 1000`)
	}
	return value
}

function assertKnownArguments() {
	const values = new Set(['--source', '--checkpoint', '--batch-size'])
	const booleans = new Set(['--commit', '--resume', '--help'])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (booleans.has(argument)) continue
		if (values.has(argument)) {
			index++
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function fingerprintFile(filename) {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256')
		const stream = fs.createReadStream(filename)
		stream.on('error', reject)
		stream.on('data', chunk => hash.update(chunk))
		stream.on('end', () => resolve(hash.digest('hex')))
	})
}

function writeCheckpoint(filename, checkpoint) {
	const partial = `${filename}.partial-${process.pid}`
	fs.writeFileSync(partial, `${JSON.stringify(checkpoint, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.renameSync(partial, filename)
}

function quotedSqliteIdentifier(value) {
	return `"${value.replaceAll('"', '""')}"`
}

function modelDelegate(client, modelName) {
	const name = `${modelName[0].toLowerCase()}${modelName.slice(1)}`
	const delegate = client[name]
	if (!delegate?.createMany || !delegate?.count) {
		throw new Error(`Missing Prisma delegate for ${modelName}`)
	}
	return delegate
}

function validateSource(source, requiredMigrations) {
	const integrity = source.pragma('integrity_check').flatMap(Object.values)
	if (integrity.length !== 1 || integrity[0] !== 'ok') {
		throw new Error(`SQLite integrity check failed: ${integrity.join('; ')}`)
	}
	const foreignKeyProblems = source.pragma('foreign_key_check')
	if (foreignKeyProblems.length) {
		throw new Error(
			`SQLite snapshot has ${foreignKeyProblems.length} foreign-key violation(s)`,
		)
	}
	const applied = new Set(
		source
			.prepare(
				`SELECT migration_name FROM "_prisma_migrations"
				 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
			)
			.all()
			.map(row => row.migration_name),
	)
	const missing = requiredMigrations.filter(
		migration => !applied.has(migration),
	)
	if (missing.length) {
		throw new Error(
			`SQLite snapshot is missing migrations: ${missing.join(', ')}`,
		)
	}
}

function sourceCount(source, table) {
	return Number(
		source
			.prepare(`SELECT COUNT(*) AS count FROM ${quotedSqliteIdentifier(table)}`)
			.get().count,
	)
}

function sourceRows(source, table, limit, offset) {
	return source
		.prepare(
			`SELECT * FROM ${quotedSqliteIdentifier(table)}
			 ORDER BY rowid LIMIT ? OFFSET ?`,
		)
		.all(limit, offset)
}

async function targetJoinCount(client, table) {
	const rows = await client.$queryRawUnsafe(
		`SELECT COUNT(*)::int AS count FROM "${table}"`,
	)
	return Number(rows[0].count)
}

async function insertJoinRows(client, table, rows) {
	if (!rows.length) return 0
	const values = rows.flatMap(row => [row.A, row.B])
	const tuples = rows
		.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
		.join(', ')
	return client.$executeRawUnsafe(
		`INSERT INTO "${table}" ("A", "B") VALUES ${tuples} ON CONFLICT DO NOTHING`,
		...values,
	)
}

async function targetCounts(client, models) {
	const counts = new Map()
	for (const model of models) {
		counts.set(model.name, await modelDelegate(client, model.name).count())
	}
	for (const table of implicitJoinTables) {
		counts.set(table, await targetJoinCount(client, table))
	}
	return counts
}

function printInventory(source, models, plan) {
	console.log('Transfer order:')
	for (const name of plan) {
		const model = models.find(candidate => candidate.name === name)
		console.log(`  ${name}: ${sourceCount(source, model.dbName ?? name)} rows`)
	}
	for (const table of implicitJoinTables) {
		console.log(`  ${table}: ${sourceCount(source, table)} rows`)
	}
}

async function transferModel({ client, source, model, batchSize, onProgress }) {
	const table = model.dbName ?? model.name
	const total = sourceCount(source, table)
	const selfRelations = model.fields.some(
		field =>
			field.kind === 'object' &&
			field.type === model.name &&
			field.relationFromFields?.length,
	)
	const allRows = selfRelations
		? sortRowsForSelfRelations(model, sourceRows(source, table, total || 1, 0))
		: null
	let inserted = 0
	for (let offset = 0; offset < total; offset += batchSize) {
		const rows =
			allRows?.slice(offset, offset + batchSize) ??
			sourceRows(source, table, batchSize, offset)
		const result = await modelDelegate(client, model.name).createMany({
			data: rows.map(row => convertSqliteRow(model, row)),
			skipDuplicates: true,
		})
		inserted += result.count
		onProgress(Math.min(offset + rows.length, total), total, inserted)
	}
	return { total, inserted }
}

async function transferJoinTable({
	client,
	source,
	table,
	batchSize,
	onProgress,
}) {
	const total = sourceCount(source, table)
	let inserted = 0
	for (let offset = 0; offset < total; offset += batchSize) {
		const rows = sourceRows(source, table, batchSize, offset)
		inserted += await insertJoinRows(client, table, rows)
		onProgress(Math.min(offset + rows.length, total), total, inserted)
	}
	return { total, inserted }
}

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const rawSourcePath = valueFor('--source')
	if (!rawSourcePath) throw new Error('--source is required')
	const sourcePath = path.resolve(rawSourcePath)
	if (!fs.existsSync(sourcePath))
		throw new Error(`Snapshot not found: ${sourcePath}`)
	const commit = args.includes('--commit')
	const resume = args.includes('--resume')
	const checkpointPath = path.resolve(
		valueFor('--checkpoint') ?? `${sourcePath}.postgres-transfer.json`,
	)
	const batchSize = positiveInteger('--batch-size', 250)
	const liveSqlitePath = path.resolve(
		process.env.DATABASE_PATH || path.join('prisma', 'data.db'),
	)
	if (commit && sourcePath === liveSqlitePath) {
		throw new Error(
			'Commit mode refuses the live SQLite database; use a verified backup snapshot',
		)
	}

	const requiredMigrations = listRequiredMigrations(
		path.join(process.cwd(), 'prisma', 'migrations'),
	)
	const source = new Database(sourcePath, {
		readonly: true,
		fileMustExist: true,
	})
	const models = Prisma.dmmf.datamodel.models
	const plan = buildModelTransferPlan(models)
	try {
		validateSource(source, requiredMigrations)
		console.log(`Source: ${sourcePath}`)
		console.log(
			`Mode: ${commit ? (resume ? 'COMMIT/RESUME' : 'COMMIT') : 'DRY-RUN'}`,
		)
		console.log(`Batch size: ${batchSize}`)
		printInventory(source, models, plan)
		if (!commit) return

		assertPostgresDatabaseUrl(process.env.DATABASE_URL)
		const sourceFingerprint = await fingerprintFile(sourcePath)
		const targetIdentity = postgresTargetIdentity(process.env.DATABASE_URL)
		let checkpoint
		if (resume) {
			if (!fs.existsSync(checkpointPath)) {
				throw new Error(`Resume checkpoint not found: ${checkpointPath}`)
			}
			checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
			if (
				checkpoint.version !== 1 ||
				!Array.isArray(checkpoint.completedTables)
			) {
				throw new Error(
					'Resume checkpoint has an unsupported or invalid format',
				)
			}
			if (
				checkpoint.sourceSha256 !== sourceFingerprint ||
				checkpoint.target !== targetIdentity
			) {
				throw new Error(
					'Resume checkpoint does not match this snapshot and PostgreSQL target',
				)
			}
		} else {
			if (fs.existsSync(checkpointPath)) {
				throw new Error(
					`Checkpoint already exists: ${checkpointPath}; choose a new --checkpoint or use --resume after verification`,
				)
			}
			checkpoint = {
				version: 1,
				source: sourcePath,
				sourceSha256: sourceFingerprint,
				target: targetIdentity,
				startedAt: new Date().toISOString(),
				status: 'running',
				completedTables: [],
			}
		}
		const generatedSchema = fs.readFileSync(
			path.resolve('node_modules/.prisma/client/schema.prisma'),
			'utf8',
		)
		if (!generatedSchema.includes('provider = "postgresql"')) {
			throw new Error(
				'Generate the PostgreSQL Prisma client before commit mode',
			)
		}

		const client = new PrismaClient()
		try {
			const before = await targetCounts(client, models)
			let occupied = [...before].filter(([, count]) => count > 0)
			if (
				occupied.length &&
				!resume &&
				containsOnlyMigrationSeededReferenceRows(before)
			) {
				console.log(
					'Target contains only migration-seeded reference rows; replacing them with the snapshot values.',
				)
				await client.$transaction([
					client.$executeRaw`DELETE FROM "_PermissionToRole"`,
					client.listType.deleteMany(),
					client.permission.deleteMany(),
					client.role.deleteMany(),
				])
				const afterReferenceCleanup = await targetCounts(client, models)
				occupied = [...afterReferenceCleanup].filter(([, count]) => count > 0)
			}
			if (occupied.length && !resume) {
				throw new Error(
					`PostgreSQL target is not empty (${occupied
						.map(([name, count]) => `${name}=${count}`)
						.join(', ')}); use --resume only for this same snapshot`,
				)
			}
			writeCheckpoint(checkpointPath, checkpoint)

			for (const name of plan) {
				const model = models.find(candidate => candidate.name === name)
				const result = await transferModel({
					client,
					source,
					model,
					batchSize,
					onProgress(processed, total, inserted) {
						console.log(
							`${name}: ${processed}/${total} read; ${inserted} inserted this run`,
						)
					},
				})
				if (!result.total) console.log(`${name}: empty`)
				if (!checkpoint.completedTables.includes(name)) {
					checkpoint.completedTables.push(name)
					writeCheckpoint(checkpointPath, checkpoint)
				}
			}
			for (const table of implicitJoinTables) {
				const result = await transferJoinTable({
					client,
					source,
					table,
					batchSize,
					onProgress(processed, total, inserted) {
						console.log(
							`${table}: ${processed}/${total} read; ${inserted} inserted this run`,
						)
					},
				})
				if (!result.total) console.log(`${table}: empty`)
				if (!checkpoint.completedTables.includes(table)) {
					checkpoint.completedTables.push(table)
					writeCheckpoint(checkpointPath, checkpoint)
				}
			}

			const after = await targetCounts(client, models)
			const mismatches = [...after].filter(([name, count]) => {
				const model = models.find(candidate => candidate.name === name)
				const table = model?.dbName ?? name
				return count !== sourceCount(source, table)
			})
			if (mismatches.length) {
				throw new Error(
					`Transfer count mismatch: ${mismatches
						.map(
							([name, count]) =>
								`${name} target=${count} source=${sourceCount(source, name)}`,
						)
						.join(', ')}`,
				)
			}
			const invalidConstraints = await client.$queryRaw`
				SELECT conname FROM pg_constraint
				WHERE contype = 'f' AND NOT convalidated
			`
			if (invalidConstraints.length) {
				throw new Error(
					'PostgreSQL contains unvalidated foreign-key constraints',
				)
			}
			checkpoint.status = 'completed'
			checkpoint.completedAt = new Date().toISOString()
			writeCheckpoint(checkpointPath, checkpoint)
			console.log(
				'Transfer complete: every model and implicit join table matches the snapshot row counts.',
			)
			console.log(`Checkpoint: ${checkpointPath}`)
		} finally {
			await client.$disconnect()
		}
	} finally {
		source.close()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
