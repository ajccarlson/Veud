import fs from 'node:fs'
import { execa } from 'execa'
import { listRequiredMigrations } from './backup-utils.mjs'
import {
	assertSafeRestoreTarget,
	parsePostgresConnection,
	postgresConnectionEnv,
} from './postgres-backup-utils.mjs'

function command(name, fallback) {
	return process.env[name]?.trim() || fallback
}

async function run(binary, args, connection, capture = false) {
	return execa(binary, args, {
		env: { ...process.env, ...postgresConnectionEnv(connection) },
		...(capture ? {} : { stdio: 'inherit' }),
	})
}

function verificationQuery(expectedUsername) {
	const escapedUsername = expectedUsername?.replaceAll("'", "''")
	return `
		SELECT
			(SELECT COUNT(*) FROM "User")::text || '|' ||
			(SELECT COUNT(*) FROM "Watchlist")::text || '|' ||
			(SELECT COUNT(*) FROM "Entry")::text || '|' ||
			(SELECT COUNT(*) FROM "Media")::text || '|' ||
			(SELECT COUNT(*) FROM "_prisma_migrations"
			 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || '|' ||
			(SELECT COUNT(*) FROM pg_constraint
			 WHERE contype = 'f' AND NOT convalidated)::text || '|' ||
			(SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm')::text
			${escapedUsername ? `|| '|' || (SELECT COUNT(*) FROM "User" WHERE username = '${escapedUsername}')::text` : ''};
	`
}

export async function verifyPostgresBackup({
	backupPath,
	sourceUrl,
	verifyUrl,
	expectedUsername,
}) {
	if (!fs.existsSync(backupPath))
		throw new Error(`Backup not found: ${backupPath}`)
	const source = parsePostgresConnection(sourceUrl, 'DATABASE_URL')
	const verify = parsePostgresConnection(
		verifyUrl,
		'POSTGRES_BACKUP_VERIFY_URL',
	)
	assertSafeRestoreTarget(source, verify)
	await inspectPostgresBackup({ backupPath, connectionUrl: verifyUrl })
	const pgRestore = command('PG_RESTORE_BIN', 'pg_restore')
	const psql = command('PSQL_BIN', 'psql')

	await run(
		psql,
		[
			'--set',
			'ON_ERROR_STOP=1',
			'--command',
			'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER;',
		],
		verify,
	)
	await run(
		pgRestore,
		[
			'--exit-on-error',
			'--no-owner',
			'--no-privileges',
			'--dbname',
			verify.database,
			backupPath,
		],
		verify,
	)

	const requiredMigrations = listRequiredMigrations(
		'prisma/postgresql/migrations',
	)
	const migrationResult = await run(
		psql,
		[
			'--set',
			'ON_ERROR_STOP=1',
			'--tuples-only',
			'--no-align',
			'--command',
			`SELECT migration_name FROM "_prisma_migrations"
			 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
			 ORDER BY migration_name;`,
		],
		verify,
		true,
	)
	const appliedMigrations = new Set(
		migrationResult.stdout.split(/\r?\n/).filter(Boolean),
	)
	const missingMigrations = requiredMigrations.filter(
		migration => !appliedMigrations.has(migration),
	)
	if (missingMigrations.length) {
		throw new Error(
			`Restored PostgreSQL backup is missing migrations: ${missingMigrations.join(', ')}`,
		)
	}

	const result = await run(
		psql,
		[
			'--set',
			'ON_ERROR_STOP=1',
			'--tuples-only',
			'--no-align',
			'--command',
			verificationQuery(expectedUsername),
		],
		verify,
		true,
	)
	const [
		users,
		watchlists,
		entries,
		media,
		migrations,
		invalidFks,
		trgm,
		account,
	] = result.stdout.trim().split('|').map(Number)
	if (
		[users, watchlists, entries, media, migrations, invalidFks, trgm].some(
			Number.isNaN,
		)
	) {
		throw new Error('Could not parse PostgreSQL restore verification counts')
	}
	if (invalidFks !== 0)
		throw new Error('Restored PostgreSQL has invalid foreign keys')
	if (trgm !== 1) throw new Error('Restored PostgreSQL is missing pg_trgm')
	if (expectedUsername && account !== 1) {
		throw new Error(
			'Restored PostgreSQL does not contain BACKUP_VERIFY_USERNAME',
		)
	}
	return { users, watchlists, entries, media, migrations }
}

export async function inspectPostgresBackup({ backupPath, connectionUrl }) {
	if (!fs.existsSync(backupPath))
		throw new Error(`Backup not found: ${backupPath}`)
	const connection = parsePostgresConnection(
		connectionUrl,
		'POSTGRES_BACKUP_VERIFY_URL',
	)
	await run(
		command('PG_RESTORE_BIN', 'pg_restore'),
		['--list', backupPath],
		connection,
		true,
	)
}

export async function createPostgresBackup({ outputPath, sourceUrl }) {
	const source = parsePostgresConnection(sourceUrl, 'DATABASE_URL')
	const pgDump = command('PG_DUMP_BIN', 'pg_dump')
	await run(
		pgDump,
		[
			'--format=custom',
			'--compress=6',
			'--no-owner',
			'--no-privileges',
			'--file',
			outputPath,
		],
		source,
	)
	if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
		throw new Error('pg_dump did not create a non-empty archive')
	}
}
