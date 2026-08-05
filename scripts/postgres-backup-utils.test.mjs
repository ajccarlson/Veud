import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
	assertIndependentBackupMount,
	assertSafeRestoreTarget,
	canonicalPostgresConnectionIdentity,
	canonicalPostgresHost,
	findLatestPostgresBackup,
	parsePostgresConnection,
	postgresConnectionIdentity,
	postgresConnectionEnv,
	prunePostgresBackups,
} from './postgres-backup-utils.mjs'

let tempDir

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-postgres-backup-test-'))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

test('parses PostgreSQL credentials into non-command-line environment values', () => {
	const connection = parsePostgresConnection(
		'postgresql://veud:p%40ss@db.example:5433/catalog?sslmode=require',
		'DATABASE_URL',
	)
	expect(connection).toEqual({
		host: 'db.example',
		port: '5433',
		user: 'veud',
		password: 'p@ss',
		database: 'catalog',
		sslmode: 'require',
	})
	expect(postgresConnectionEnv(connection)).toEqual({
		PGHOST: 'db.example',
		PGPORT: '5433',
		PGUSER: 'veud',
		PGPASSWORD: 'p@ss',
		PGDATABASE: 'catalog',
		PGSSLMODE: 'require',
	})
})

test('requires a clearly disposable restore database distinct from primary', () => {
	const source = parsePostgresConnection(
		'postgresql://veud@db.example/veud',
		'DATABASE_URL',
	)
	expect(() =>
		assertSafeRestoreTarget(
			source,
			parsePostgresConnection(
				'postgresql://veud@another.example/veud',
				'POSTGRES_BACKUP_VERIFY_URL',
			),
		),
	).toThrow('database name must differ')
	expect(() =>
		assertSafeRestoreTarget(
			source,
			parsePostgresConnection(
				'postgresql://veud@db.example/production_copy',
				'POSTGRES_BACKUP_VERIFY_URL',
			),
		),
	).toThrow('must contain restore, verify, or drill')
	expect(() =>
		assertSafeRestoreTarget(
			source,
			parsePostgresConnection(
				'postgresql://veud@db.example/veud_restore',
				'POSTGRES_BACKUP_VERIFY_URL',
			),
		),
	).not.toThrow()
})

test('canonicalizes local PostgreSQL aliases before comparing identities', () => {
	for (const host of [
		'localhost',
		'localhost.',
		'localhost.localdomain',
		'127.0.0.1',
		'127.4.3.2',
		'ip6-loopback',
		'::1',
		'[::1]',
		'0:0:0:0:0:0:0:1',
		'::ffff:127.0.0.1',
		'::ffff:127.4.3.2',
		'::ffff:7f00:1',
		'::ffff:7f04:302',
	]) {
		expect(canonicalPostgresHost(host)).toBe('loopback')
	}
	expect(
		canonicalPostgresConnectionIdentity(
			parsePostgresConnection(
				'postgresql://owner@localhost:5433/catalog',
				'DATABASE_URL',
			),
		),
	).toBe('loopback:5433/catalog')
	expect(
		postgresConnectionIdentity(
			parsePostgresConnection(
				'postgresql://owner@127.0.0.1:5433/catalog',
				'DATABASE_URL',
			),
		),
	).toBe('127.0.0.1:5433/catalog')
	expect(
		canonicalPostgresConnectionIdentity(
			parsePostgresConnection(
				'postgresql://owner@[::ffff:127.4.3.2]:5433/catalog',
				'DATABASE_URL',
			),
		),
	).toBe('loopback:5433/catalog')
})

test('finds and prunes only PostgreSQL custom-format archives', () => {
	const oldBackup = path.join(tempDir, 'postgres-old.dump')
	const newBackup = path.join(tempDir, 'postgres-new.dump')
	fs.writeFileSync(oldBackup, 'old')
	fs.writeFileSync(newBackup, 'new')
	fs.writeFileSync(`${oldBackup}.restore-verified.json`, 'old receipt')
	fs.writeFileSync(`${newBackup}.restore-verified.json`, 'new receipt')
	fs.writeFileSync(path.join(tempDir, 'data-ignore.db'), 'sqlite')
	fs.utimesSync(oldBackup, new Date(0), new Date(0))

	expect(findLatestPostgresBackup(tempDir)).toBe(newBackup)
	expect(prunePostgresBackups(tempDir, 1)).toEqual(['postgres-old.dump'])
	expect(fs.existsSync(`${oldBackup}.restore-verified.json`)).toBe(false)
	expect(fs.existsSync(path.join(tempDir, 'data-ignore.db'))).toBe(true)
})

test('does not select an archive whose restore receipt was never published', () => {
	const incomplete = path.join(tempDir, 'postgres-newer.dump')
	const complete = path.join(tempDir, 'postgres-older.dump')
	fs.writeFileSync(incomplete, 'incomplete')
	fs.writeFileSync(complete, 'complete')
	fs.writeFileSync(`${complete}.restore-verified.json`, 'receipt')
	fs.utimesSync(complete, new Date(0), new Date(0))

	expect(findLatestPostgresBackup(tempDir)).toBe(complete)
})

test('requires the offsite directory to be on a distinct mounted filesystem', () => {
	const mountPoint = path.join(tempDir, 'drive')
	const offsiteDir = path.join(mountPoint, 'backups')
	fs.mkdirSync(offsiteDir, { recursive: true })
	expect(() =>
		assertIndependentBackupMount(offsiteDir, mountPoint, 0, {
			realpath: value => value,
			stat: () => ({ dev: 1 }),
			statfs: () => ({ bavail: 100, bsize: 1 }),
		}),
	).toThrow('not a distinct mounted filesystem')
})

test('requires adequate free space on a verified offsite mount', () => {
	const mountPoint = path.join(tempDir, 'drive')
	const offsiteDir = path.join(mountPoint, 'backups')
	fs.mkdirSync(offsiteDir, { recursive: true })
	const operations = {
		realpath: value => value,
		stat: value => ({ dev: value === mountPoint ? 2 : 1 }),
		statfs: () => ({ bavail: 9, bsize: 10 }),
	}
	expect(() =>
		assertIndependentBackupMount(offsiteDir, mountPoint, 100, operations),
	).toThrow('90 bytes available; 100 required')
	expect(() =>
		assertIndependentBackupMount(offsiteDir, mountPoint, 90, operations),
	).not.toThrow()
})

test('an offsite directory without a mountpoint is refused, not waved through', () => {
	// Returning quietly here was the failure: an unmounted directory then
	// absorbs "offsite" copies onto the primary disk while the pipeline reports
	// success and every copy shares one drive.
	const offsiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-offsite-'))
	try {
		for (const missing of [undefined, '', '   ']) {
			expect(() => assertIndependentBackupMount(offsiteDir, missing)).toThrow(
				'BACKUP_OFFSITE_MOUNTPOINT must be set',
			)
		}
	} finally {
		fs.rmSync(offsiteDir, { recursive: true, force: true })
	}
})
