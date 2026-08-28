import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
	assertCatalogWriterRuntimeProof,
	expectedCatalogWriterLockPath,
	identifyLiveCatalogDatabase,
} from './catalog-writer-runtime-guard.mjs'

const productionUrl =
	'postgresql://veud_production_app:secret@127.0.0.1:5433/veud_production?schema=public'
const stagingUrl =
	'postgresql://veud_staging_app:secret@127.0.0.1:5433/veud_staging?schema=public'
const stagingLoadUrl =
	'postgresql://veud_staging_load:secret@127.0.0.1:5433/veud_staging_load?schema=public'

let tempDir
const children = new Set()

beforeEach(() => {
	tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-catalog-writer-proof-test-'),
	)
})

afterEach(async () => {
	const exits = new Map()
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			exits.set(child, once(child, 'exit'))
			child.kill('SIGKILL')
		}
	}
	await Promise.all(exits.values())
	children.clear()
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function waitForLine(child, stream, expected) {
	return new Promise((resolve, reject) => {
		let output = ''
		let stderr = ''
		const cleanup = () => {
			clearTimeout(timer)
			stream.off('data', onData)
			child.stderr.off('data', onStderr)
			child.off('close', onExit)
		}
		const timer = setTimeout(() => {
			cleanup()
			reject(
				new Error(`Timed out waiting for ${expected}: ${stderr || output}`),
			)
		}, 5_000)
		const onData = chunk => {
			output += chunk
			if (!output.includes(expected)) return
			cleanup()
			resolve()
		}
		const onStderr = chunk => {
			stderr += chunk
		}
		const onExit = (code, signal) => {
			cleanup()
			reject(
				new Error(
					`Process exited before ${expected} (${code ?? signal}): ${stderr || output}`,
				),
			)
		}
		stream.on('data', onData)
		child.stderr.on('data', onStderr)
		child.once('close', onExit)
	})
}

async function startLockHolder(lockPath, descriptor = 8) {
	const child = spawn(
		'/bin/bash',
		[
			'-c',
			`exec ${descriptor}>"$1"; flock --shared ${descriptor}; printf 'ready\\n'; read -r _`,
			'bash',
			lockPath,
		],
		{ stdio: ['pipe', 'pipe', 'pipe'] },
	)
	children.add(child)
	await waitForLine(child, child.stdout, 'ready')
	return child
}

async function startRuntimeProofProcess(lockPath, extraEnvironment = {}) {
	const helper = path.join(
		tempDir,
		`runtime-proof-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`,
	)
	const readyPath = `${helper}.ready`
	const guardModule = pathToFileURL(
		path.join(process.cwd(), 'scripts/catalog-writer-runtime-guard.mjs'),
	).href
	fs.writeFileSync(
		helper,
		`import fs from "node:fs"
import { assertCatalogWriterRuntimeProof } from ${JSON.stringify(guardModule)}
assertCatalogWriterRuntimeProof(process.env)
fs.writeFileSync(process.env.VEUD_TEST_READY_PATH, "ready")
setInterval(() => {}, 1000)
`,
		{ mode: 0o600 },
	)
	let stderr = ''
	const child = spawn(
		'/bin/bash',
		[
			'-c',
			`
				set -Eeuo pipefail
				exec 8>"$1"
				export VEUD_CATALOG_WRITER_LOCK_HOLDER_PID="$$"
				exec "$NODE_BIN" "$2"
			`,
			'bash',
			lockPath,
			helper,
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				DATABASE_URL: productionUrl,
				NODE_BIN: process.execPath,
				VEUD_STAGING_LIVE_MOUNT: tempDir,
				VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT: 'production',
				VEUD_CATALOG_WRITER_LOCK_PATH: lockPath,
				VEUD_CATALOG_WRITER_LOCK_FDS: '8',
				VEUD_TEST_READY_PATH: readyPath,
				...extraEnvironment,
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	)
	children.add(child)
	child.stderr.on('data', chunk => {
		stderr += chunk
	})
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(poll)
			reject(new Error(`Timed out waiting for runtime proof: ${stderr}`))
		}, 5_000)
		const poll = setInterval(() => {
			if (!fs.existsSync(readyPath)) {
				if (child.exitCode === null && child.signalCode === null) return
				clearInterval(poll)
				clearTimeout(timeout)
				reject(new Error(`Runtime proof exited before readiness: ${stderr}`))
				return
			}
			clearInterval(poll)
			clearTimeout(timeout)
			resolve()
		}, 10)
	})
	return child
}

function exclusiveLockAvailable(lockPath) {
	return (
		spawnSync(
			'/usr/bin/flock',
			['--exclusive', '--nonblock', lockPath, 'true'],
			{ encoding: 'utf8' },
		).status === 0
	)
}

async function stopChild(child) {
	if (child.exitCode === null && child.signalCode === null) {
		const exited = once(child, 'exit')
		child.kill('SIGKILL')
		await exited
	}
	children.delete(child)
}

function proofEnvironment(databaseUrl, holder, environment, descriptor = 8) {
	const liveMount = tempDir
	const root =
		environment === 'production'
			? path.join(liveMount, 'veud-production')
			: path.join(liveMount, 'veud-staging-postgres')
	return {
		DATABASE_URL: databaseUrl,
		VEUD_STAGING_LIVE_MOUNT: liveMount,
		VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT: environment,
		VEUD_CATALOG_WRITER_LOCK_PATH: path.join(
			root,
			'run/catalog-writer-lifetime.lock',
		),
		VEUD_CATALOG_WRITER_LOCK_HOLDER_PID: String(holder.pid),
		VEUD_CATALOG_WRITER_LOCK_FDS: `6,${descriptor}`,
	}
}

describe('live catalog database identities', () => {
	test('recognizes the three live writer role/database pairs through every endpoint spelling', () => {
		expect(identifyLiveCatalogDatabase(productionUrl)?.environment).toBe(
			'production',
		)
		expect(identifyLiveCatalogDatabase(stagingUrl)?.environment).toBe('staging')
		expect(identifyLiveCatalogDatabase(stagingLoadUrl)?.environment).toBe(
			'staging',
		)
		expect(
			identifyLiveCatalogDatabase(
				productionUrl.replace('127.0.0.1', 'localhost.'),
			)?.environment,
		).toBe('production')
		expect(
			identifyLiveCatalogDatabase(productionUrl.replace('127.0.0.1', '[::1]'))
				?.environment,
		).toBe('production')
		for (const endpoint of [
			'127.1:5433',
			'2130706433:5433',
			'0x7f000001:5433',
			'017700000001:5433',
			'[::ffff:127.0.0.1]:5433',
			'db.internal.example:6432',
		]) {
			expect(
				identifyLiveCatalogDatabase(
					productionUrl.replace('127.0.0.1:5433', endpoint),
				)?.environment,
				endpoint,
			).toBe('production')
		}
		expect(
			identifyLiveCatalogDatabase(
				productionUrl
					.replace('postgresql:', 'postgres:')
					.replace('veud_production_app', '%76eud_production_app')
					.replace('/veud_production?', '/%76eud_production?'),
			)?.environment,
		).toBe('production')
		expect(
			identifyLiveCatalogDatabase(
				'postgresql://tester:secret@127.0.0.1:5433/veud_test?schema=public',
			),
		).toBeUndefined()
		expect(identifyLiveCatalogDatabase('file:/tmp/test.db')).toBeUndefined()
	})

	test('derives exact production and staging lock paths', () => {
		expect(
			expectedCatalogWriterLockPath('production', {
				VEUD_STAGING_LIVE_MOUNT: '/live',
			}),
		).toBe('/live/veud-production/run/catalog-writer-lifetime.lock')
		expect(
			expectedCatalogWriterLockPath('staging', {
				VEUD_STAGING_ROOT: '/custom/staging',
			}),
		).toBe('/custom/staging/run/catalog-writer-lifetime.lock')
	})
})

describe('catalog writer runtime proof', () => {
	test('does not constrain disposable PostgreSQL or SQLite databases', () => {
		expect(
			assertCatalogWriterRuntimeProof({
				DATABASE_URL:
					'postgresql://tester:secret@127.0.0.1:5433/veud_test?schema=public',
			}),
		).toBe(false)
		expect(
			assertCatalogWriterRuntimeProof({
				DATABASE_URL: 'file:/tmp/veud-test.db',
			}),
		).toBe(false)
	})

	test.each([
		['production application', productionUrl],
		['staging application', stagingUrl],
		['staging load', stagingLoadUrl],
	])('blocks direct %s access without a proof', (_, databaseUrl) => {
		expect(() =>
			assertCatalogWriterRuntimeProof({ DATABASE_URL: databaseUrl }),
		).toThrow('use a catalog-writer lifetime-lock launcher')
	})

	test.each([
		'127.1:5433',
		'2130706433:5433',
		'0x7f000001:5433',
		'017700000001:5433',
		'[::ffff:127.0.0.1]:5433',
		'db.internal.example:6432',
	])('blocks a production identity reached through %s', endpoint => {
		const databaseUrl = productionUrl.replace('127.0.0.1:5433', endpoint)
		expect(() =>
			assertCatalogWriterRuntimeProof({ DATABASE_URL: databaseUrl }),
		).toThrow('use a catalog-writer lifetime-lock launcher')
	})

	test('fails closed on invalid PostgreSQL identity encoding', () => {
		expect(() =>
			assertCatalogWriterRuntimeProof({
				DATABASE_URL:
					'postgresql://veud_production_app%:secret@127.0.0.1:5433/veud_production?schema=public',
			}),
		).toThrow('invalid URL encoding')
	})

	test('accepts an ancestor holding the exact shared lock', async () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const holder = await startLockHolder(lockPath)
		const env = proofEnvironment(productionUrl, holder, 'production')
		expect(
			assertCatalogWriterRuntimeProof(env, {
				currentPid: holder.pid,
				descriptorLockAcquire: () => true,
			}),
		).toBe(true)
	})

	test('accepts the real wrapper proof after exec with the shared lock', () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const result = spawnSync(
			'bash',
			[
				'-c',
				`
					set -Eeuo pipefail
					exec 8>"$VEUD_CATALOG_WRITER_LOCK_PATH"
					flock --shared 8
					export VEUD_CATALOG_WRITER_LOCK_HOLDER_PID="$$"
					exec "$NODE_BIN" scripts/assert-catalog-writer-runtime.mjs
				`,
			],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
				env: {
					...process.env,
					DATABASE_URL: productionUrl,
					NODE_BIN: process.execPath,
					VEUD_STAGING_LIVE_MOUNT: tempDir,
					VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT: 'production',
					VEUD_CATALOG_WRITER_LOCK_PATH: lockPath,
					VEUD_CATALOG_WRITER_LOCK_FDS: '8',
				},
			},
		)
		expect(result.status, result.stderr).toBe(0)
	})

	test('acquires the claimed descriptor itself and keeps the lock for the process lifetime', async () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		const accidentalNumericPath = path.join(process.cwd(), '3')
		expect(fs.existsSync(accidentalNumericPath)).toBe(false)
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const hostileBin = path.join(tempDir, 'hostile-bin')
		fs.mkdirSync(hostileBin)
		fs.writeFileSync(path.join(hostileBin, 'true'), '#!/bin/sh\nexit 1\n', {
			mode: 0o700,
		})
		const guarded = await startRuntimeProofProcess(lockPath, {
			// The runtime proof must use the trusted binary, not this hostile
			// ambient override or PATH command that made the old probe fail open.
			FLOCK_BIN: '/bin/false',
			PATH: `${hostileBin}:/usr/bin:/bin`,
		})
		expect(exclusiveLockAvailable(lockPath)).toBe(false)
		await stopChild(guarded)
		expect(exclusiveLockAvailable(lockPath)).toBe(true)
		expect(fs.existsSync(accidentalNumericPath)).toBe(false)
	})

	test('does not lose safety when an unrelated shared holder exits', async () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const unrelated = await startLockHolder(lockPath, 9)
		const guarded = await startRuntimeProofProcess(lockPath)

		await stopChild(unrelated)
		expect(exclusiveLockAvailable(lockPath)).toBe(false)
		await stopChild(guarded)
		expect(exclusiveLockAvailable(lockPath)).toBe(true)
	})

	test('rejects unrelated holders, paths, and descriptors', async () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const holder = await startLockHolder(lockPath)
		const env = proofEnvironment(productionUrl, holder, 'production')
		expect(() =>
			assertCatalogWriterRuntimeProof({
				...env,
				VEUD_CATALOG_WRITER_LOCK_HOLDER_PID: '99999999',
			}),
		).toThrow('not the current process or an ancestor')
		expect(() =>
			assertCatalogWriterRuntimeProof({
				...env,
				VEUD_CATALOG_WRITER_LOCK_PATH: `${lockPath}.other`,
			}),
		).toThrow('use a catalog-writer lifetime-lock launcher')
		expect(() =>
			assertCatalogWriterRuntimeProof(
				{
					...env,
					VEUD_CATALOG_WRITER_LOCK_FDS: '6',
				},
				{
					currentPid: holder.pid,
					descriptorLockAcquire: () => true,
				},
			),
		).toThrow('do not share the expected descriptor')
	})

	test('rejects malformed, absent, and foreign fdinfo lock proofs', async () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const holder = await startLockHolder(lockPath)
		const env = proofEnvironment(productionUrl, holder, 'production')
		const inode = fs.statSync(lockPath).ino
		const withFdinfo = fdinfo =>
			assertCatalogWriterRuntimeProof(env, {
				currentPid: holder.pid,
				descriptorLockAcquire: () => true,
				readFile: (target, encoding) => {
					if (String(target).includes('/fdinfo/')) return fdinfo
					return fs.readFileSync(target, encoding)
				},
			})

		// An absent lock: line proves nothing about ownership.
		expect(() => withFdinfo('pos:\t0\nflags:\t0100000\n')).toThrow(
			'does not own the shared lock',
		)
		// Truncated, corrupt, and empty fdinfo must never be treated as proof.
		expect(() => withFdinfo('')).toThrow('does not own the shared lock')
		expect(() => withFdinfo('lock:\t1: FLOCK ADVISORY READ')).toThrow(
			'does not own the shared lock',
		)
		expect(() => withFdinfo('lock:\tnonsense\n')).toThrow(
			'does not own the shared lock',
		)
		// A lock on a DIFFERENT inode is the unrelated-holder case.
		expect(() =>
			withFdinfo(
				`lock:\t1: FLOCK ADVISORY READ ${holder.pid} fd:00:${inode + 1} 0 EOF\n`,
			),
		).toThrow('does not own the shared lock')
		// An exclusive WRITE lock is not the shared lock the guard requires.
		expect(() =>
			withFdinfo(
				`lock:\t1: FLOCK ADVISORY WRITE ${holder.pid} fd:00:${inode} 0 EOF\n`,
			),
		).toThrow('does not own the shared lock')
		// POSIX record locks are not flock ownership.
		expect(() =>
			withFdinfo(
				`lock:\t1: POSIX ADVISORY READ ${holder.pid} fd:00:${inode} 0 EOF\n`,
			),
		).toThrow('does not own the shared lock')
		// A partial-range lock does not cover the whole file.
		expect(() =>
			withFdinfo(
				`lock:\t1: FLOCK ADVISORY READ ${holder.pid} fd:00:${inode} 0 128\n`,
			),
		).toThrow('does not own the shared lock')
		// Unreadable fdinfo fails closed with its own diagnostic.
		expect(() =>
			assertCatalogWriterRuntimeProof(env, {
				currentPid: holder.pid,
				descriptorLockAcquire: () => true,
				readFile: target => {
					if (String(target).includes('/fdinfo/')) {
						throw new Error('ENOENT')
					}
					return fs.readFileSync(target, 'utf8')
				},
			}),
		).toThrow('descriptor proof is unavailable')
		// The exact matching line is still accepted.
		expect(
			withFdinfo(
				`lock:\t1: FLOCK ADVISORY READ ${holder.pid} fd:00:${inode} 0 EOF\n`,
			),
		).toBe(true)
	})

	test('rejects a replaced lock path even when an unrelated holder locks it', async () => {
		const root = path.join(tempDir, 'veud-production')
		const lockPath = path.join(root, 'run/catalog-writer-lifetime.lock')
		fs.mkdirSync(path.dirname(lockPath), { recursive: true })
		const holder = await startLockHolder(lockPath)
		const env = proofEnvironment(productionUrl, holder, 'production')
		const base = { currentPid: holder.pid, descriptorLockAcquire: () => true }
		// Proof succeeds on the genuine path first.
		expect(assertCatalogWriterRuntimeProof(env, base)).toBe(true)

		// Replace the path with a different file that an unrelated process locks.
		const replacement = `${lockPath}.replacement`
		fs.writeFileSync(replacement, '')
		const unrelated = await startLockHolder(replacement)
		fs.renameSync(replacement, lockPath)
		expect(() => assertCatalogWriterRuntimeProof(env, base)).toThrow()
		unrelated.kill('SIGKILL')
	})

	test('rejects lock files with unsafe type, ownership, mode, or link count', async () => {
		const root = path.join(tempDir, 'veud-production')
		const runDir = path.join(root, 'run')
		fs.mkdirSync(runDir, { recursive: true })
		const lockPath = path.join(runDir, 'catalog-writer-lifetime.lock')
		const holder = await startLockHolder(lockPath)
		const env = proofEnvironment(productionUrl, holder, 'production')
		const genuine = fs.lstatSync(lockPath)
		const base = {
			currentPid: holder.pid,
			currentUid: genuine.uid,
			descriptorLockAcquire: () => true,
		}
		expect(assertCatalogWriterRuntimeProof(env, base)).toBe(true)

		const shaped = override => ({
			...genuine,
			isSymbolicLink: () => false,
			isFile: () => true,
			...override,
		})
		const rejects = (override, label) => {
			const attempt = () =>
				assertCatalogWriterRuntimeProof(env, {
					...base,
					lstat: target =>
						String(target) === lockPath
							? shaped(override)
							: fs.lstatSync(target),
				})
			expect(attempt, label).toThrow()
		}

		rejects({ isSymbolicLink: () => true }, 'symlink')
		rejects({ isFile: () => false }, 'not a regular file')
		rejects({ nlink: genuine.nlink + 1 }, 'extra hard link')
		rejects({ uid: genuine.uid + 1 }, 'foreign owner')
		rejects({ mode: (genuine.mode & ~0o777) | 0o620 }, 'group writable')
		rejects({ mode: (genuine.mode & ~0o777) | 0o602 }, 'world writable')
		rejects({ mode: (genuine.mode & ~0o777) | 0o400 }, 'not owner writable')

		// A lock file swapped for a different inode/device mid-proof must be
		// caught by the final revalidation, not just the initial read.
		for (const drift of [{ ino: genuine.ino + 1 }, { dev: genuine.dev + 1 }]) {
			let calls = 0
			expect(() =>
				assertCatalogWriterRuntimeProof(env, {
					...base,
					lstat: target => {
						if (String(target) !== lockPath) return fs.lstatSync(target)
						calls += 1
						return calls === 1 ? shaped({}) : shaped(drift)
					},
				}),
			).toThrow('changed during proof')
		}
	})

	test('requires package scripts with mutation modes to use the proof guard', () => {
		const packageJson = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
		)
		const guarded = [
			'catalog:jikan-anime-cast',
			'catalog:mal-hydrate',
			'catalog:mal-inventory',
			'catalog:mal-trending',
			'catalog:repair-provenance',
			'catalog:sync-watchlist-metadata',
			'catalog:quality-scan',
			'catalog:tmdb-hydrate',
			'catalog:tmdb-inventory',
			'db:backup',
			'db:backup:postgres',
			'db:canary:catalog-merge:postgres',
			'db:loadtest:postgres',
			'db:migrate:postgres',
			'db:smoke:postgres',
			'db:transfer:postgres',
			'data:backfill-next-release-at',
			'data:release-audit',
			'data:retention:cleanup',
			'media:backfill',
			'moderation:bootstrap-owner',
			'notifications:digests',
			'prisma:studio',
			'setup',
			'tracking:backfill',
		]
		for (const name of guarded) {
			expect(packageJson.scripts[name], name).toMatch(
				/^node scripts\/assert-catalog-writer-runtime\.mjs && /,
			)
		}
	})

	test('guards every advertised direct Prisma writer before client initialization', () => {
		const directPrismaWriters = [
			'app/utils/db.server.ts',
			'scripts/audit-release-data.ts',
			'scripts/backfill-media-identities.ts',
			'scripts/backfill-next-release-at.ts',
			'scripts/backfill-tracking-states.ts',
			'scripts/bootstrap-community-owner.ts',
			'scripts/canary-catalog-media-merge.ts',
			'scripts/hydrate-jikan-anime-cast.ts',
			'scripts/hydrate-mal-catalog.ts',
			'scripts/hydrate-tmdb-catalog.ts',
			'scripts/import-mal-inventory.ts',
			'scripts/import-tmdb-inventory.ts',
			'scripts/load-test-postgres-catalog.mjs',
			'scripts/quarantine-media-catalog-provenance.ts',
			'scripts/refresh-mal-trending.ts',
			'scripts/scan-catalog-quality.ts',
			'scripts/smoke-postgres.ts',
			'scripts/sync-watchlist-metadata.ts',
			'scripts/transfer-sqlite-to-postgres.mjs',
		]
		for (const filename of directPrismaWriters) {
			const source = fs.readFileSync(path.join(process.cwd(), filename), 'utf8')
			const assertion = source.indexOf(
				'assertCatalogWriterRuntimeProof(process.env)',
			)
			const clientInitialization = source.indexOf('new PrismaClient')
			expect(assertion, filename).toBeGreaterThanOrEqual(0)
			expect(clientInitialization, filename).toBeGreaterThan(assertion)
		}
	})

	test('blocks a direct writer before Prisma can initialize', () => {
		const baseEnvironment = { ...process.env }
		for (const variable of [
			'VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT',
			'VEUD_CATALOG_WRITER_LOCK_FDS',
			'VEUD_CATALOG_WRITER_LOCK_HOLDER_PID',
			'VEUD_CATALOG_WRITER_LOCK_PATH',
		]) {
			delete baseEnvironment[variable]
		}
		const result = spawnSync(
			process.execPath,
			['--import', 'tsx', 'scripts/backfill-tracking-states.ts'],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
				env: {
					...baseEnvironment,
					DATABASE_URL: productionUrl,
					VEUD_STAGING_LIVE_MOUNT: tempDir,
				},
			},
		)
		expect(result.status).not.toBe(0)
		expect(result.stderr).toContain(
			'Direct production PostgreSQL access is blocked',
		)
		expect(result.stderr).not.toContain('PrismaClientInitializationError')
	})

	test('wires proof exports into both live launcher families and server startup', () => {
		const stagingCommon = fs.readFileSync(
			path.join(process.cwd(), 'ops/local-staging/common.sh'),
			'utf8',
		)
		const productionCommon = fs.readFileSync(
			path.join(process.cwd(), 'ops/local-production/common.sh'),
			'utf8',
		)
		const server = fs.readFileSync(
			path.join(process.cwd(), 'server/index.ts'),
			'utf8',
		)
		for (const variable of [
			'VEUD_CATALOG_WRITER_LOCK_ENVIRONMENT',
			'VEUD_CATALOG_WRITER_LOCK_PATH',
			'VEUD_CATALOG_WRITER_LOCK_HOLDER_PID',
			'VEUD_CATALOG_WRITER_LOCK_FDS',
		]) {
			expect(stagingCommon).toContain(`export ${variable}`)
		}
		expect(stagingCommon).toContain(
			'export_catalog_writer_lifetime_lock_proof \\\n\t\tstaging',
		)
		expect(productionCommon).toContain(
			'export_catalog_writer_lifetime_lock_proof \\\n\t\tproduction',
		)
		expect(server).toContain('assertCatalogWriterRuntimeProof(process.env)')
	})
})
