import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
	assertBackupDirectoryFreeSpace,
	assertSqlitePrimaryDatabase,
	cleanupInterruptedBackupArtifacts,
	findLatestBackup,
	listBackupFiles,
	partialBackupPath,
	copyVerifiedBackup,
	parsePositiveInteger,
	pruneBackups,
	verifyBackupDatabase,
	verifyBackupRestore,
} from './backup-utils.mjs'

let tempDir

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-backup-test-'))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function createDatabase(filename = 'data.db') {
	const databasePath = path.join(tempDir, filename)
	const db = new Database(databasePath)
	db.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE "_prisma_migrations" (
			migration_name TEXT NOT NULL,
			finished_at DATETIME,
			rolled_back_at DATETIME
		);
		CREATE TABLE "User" (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE
		);
		CREATE TABLE "Watchlist" (
			id TEXT PRIMARY KEY,
			ownerId TEXT NOT NULL REFERENCES "User"(id)
		);
		CREATE TABLE "Entry" (
			id TEXT PRIMARY KEY,
			watchlistId TEXT NOT NULL REFERENCES "Watchlist"(id)
		);
		INSERT INTO "_prisma_migrations" VALUES ('migration-1', CURRENT_TIMESTAMP, NULL);
		INSERT INTO "User" VALUES ('user-1', 'alice');
		INSERT INTO "Watchlist" VALUES ('list-1', 'user-1');
		INSERT INTO "Entry" VALUES ('entry-1', 'list-1');
	`)
	db.close()
	return databasePath
}

const verificationOptions = {
	expectedUsername: 'alice',
	requiredMigrations: ['migration-1'],
}

describe('backup verification', () => {
	test('fails closed when the primary datasource is PostgreSQL', () => {
		expect(() =>
			assertSqlitePrimaryDatabase(
				'postgresql://veud:secret@localhost:5432/veud',
			),
		).toThrow('cannot protect a PostgreSQL primary database')
		expect(() =>
			assertSqlitePrimaryDatabase('file:./prisma/data.db'),
		).not.toThrow()
	})

	test('validates a throwaway restored copy and reports core row counts', () => {
		const backupPath = createDatabase()

		expect(verifyBackupRestore(backupPath, verificationOptions)).toEqual({
			users: 1,
			watchlists: 1,
			entries: 1,
			migrations: 1,
		})
	})

	test('rejects a backup with a foreign key violation', () => {
		const backupPath = createDatabase()
		const db = new Database(backupPath)
		db.pragma('foreign_keys = OFF')
		db.prepare('INSERT INTO "Entry" VALUES (?, ?)').run('orphan', 'missing')
		db.close()

		expect(() => verifyBackupDatabase(backupPath, verificationOptions)).toThrow(
			'foreign key check failed',
		)
	})

	test('rejects a backup from the wrong schema or account', () => {
		const backupPath = createDatabase()

		expect(() =>
			verifyBackupDatabase(backupPath, {
				expectedUsername: 'missing-user',
				requiredMigrations: ['migration-1'],
			}),
		).toThrow('BACKUP_VERIFY_USERNAME')
		expect(() =>
			verifyBackupDatabase(backupPath, {
				requiredMigrations: ['migration-2'],
			}),
		).toThrow('missing applied migrations')
	})

	test('copies a verified backup atomically and prunes only matching files', () => {
		const backupPath = createDatabase('data-2026-01-01.db')
		const offsiteDir = path.join(tempDir, 'offsite')
		expect(() =>
			copyVerifiedBackup(backupPath, offsiteDir, verificationOptions),
		).toThrow('must already exist')
		fs.mkdirSync(offsiteDir)
		const { destination } = copyVerifiedBackup(
			backupPath,
			offsiteDir,
			verificationOptions,
		)
		fs.writeFileSync(path.join(offsiteDir, 'data-old.db'), 'old')
		fs.writeFileSync(path.join(offsiteDir, 'keep-me.txt'), 'unrelated')
		fs.utimesSync(
			path.join(offsiteDir, 'data-old.db'),
			new Date(0),
			new Date(0),
		)

		expect(pruneBackups(offsiteDir, 1)).toEqual(['data-old.db'])
		expect(fs.existsSync(destination)).toBe(true)
		expect(fs.existsSync(path.join(offsiteDir, 'keep-me.txt'))).toBe(true)
	})

	test('rejects invalid retention instead of pruning every backup', () => {
		expect(() =>
			parsePositiveInteger('not-a-number', 48, 'BACKUP_KEEP'),
		).toThrow('BACKUP_KEEP must be a positive integer')
		expect(parsePositiveInteger(undefined, 48, 'BACKUP_KEEP')).toBe(48)
	})
})

describe('interrupted snapshots', () => {
	test('a snapshot in progress is never listed, pruned, or restored from', () => {
		const finished = path.join(tempDir, 'data-2026-08-05T00-00-00-000Z.db')
		fs.writeFileSync(finished, 'finished')
		const inProgress = partialBackupPath(
			path.join(tempDir, 'data-2026-08-05T01-00-00-000Z.db'),
			4242,
		)
		fs.writeFileSync(inProgress, 'half written')

		expect(listBackupFiles(tempDir).map(entry => entry.name)).toEqual([
			'data-2026-08-05T00-00-00-000Z.db',
		])
		// The whole point: an unverified file must never be chosen as "latest",
		// even though its timestamp is newer.
		expect(findLatestBackup(tempDir)).toBe(finished)
		expect(pruneBackups(tempDir, 1)).toEqual([])
		expect(fs.existsSync(inProgress)).toBe(true)
	})

	test('the partial name carries the writing process', () => {
		expect(partialBackupPath('/backups/data-x.db', 17)).toBe(
			'/backups/data-x.db.partial-17',
		)
	})

	test('debris from a dead process is cleared once it is stale', () => {
		const artifact = partialBackupPath(path.join(tempDir, 'data-a.db'), 9001)
		fs.writeFileSync(artifact, 'debris')
		const removed = cleanupInterruptedBackupArtifacts(tempDir, {
			isRunning: () => false,
			now: () => Date.now() + 7 * 60 * 60 * 1_000,
		})
		expect(removed).toEqual(['data-a.db.partial-9001'])
		expect(fs.existsSync(artifact)).toBe(false)
	})

	test('a snapshot another process is still writing is left alone', () => {
		const artifact = partialBackupPath(path.join(tempDir, 'data-b.db'), 9002)
		fs.writeFileSync(artifact, 'in progress')
		expect(
			cleanupInterruptedBackupArtifacts(tempDir, {
				isRunning: () => true,
				now: () => Date.now() + 7 * 60 * 60 * 1_000,
			}),
		).toEqual([])
		// And a dead process's file is still young enough to be in doubt.
		expect(
			cleanupInterruptedBackupArtifacts(tempDir, {
				isRunning: () => false,
				now: () => Date.now(),
			}),
		).toEqual([])
		expect(fs.existsSync(artifact)).toBe(true)
	})

	test('finished snapshots are never mistaken for debris', () => {
		const finished = path.join(tempDir, 'data-2026-08-05T02-00-00-000Z.db')
		fs.writeFileSync(finished, 'finished')
		expect(
			cleanupInterruptedBackupArtifacts(tempDir, {
				isRunning: () => false,
				now: () => Date.now() + 7 * 60 * 60 * 1_000,
			}),
		).toEqual([])
		expect(fs.existsSync(finished)).toBe(true)
	})
})

describe('free space', () => {
	const statfs = available => () => ({ bavail: available, bsize: 1 })

	test('a snapshot is refused when the disk cannot hold it', () => {
		expect(() =>
			assertBackupDirectoryFreeSpace(tempDir, 1_000, { statfs: statfs(999) }),
		).toThrow('999 bytes available')
		expect(
			assertBackupDirectoryFreeSpace(tempDir, 1_000, { statfs: statfs(1_000) }),
		).toBe(1_000)
	})

	test('no floor means no check, and a nonsensical floor is refused', () => {
		expect(
			assertBackupDirectoryFreeSpace(tempDir, 0, {
				statfs: () => {
					throw new Error('must not be consulted')
				},
			}),
		).toBeUndefined()
		expect(() => assertBackupDirectoryFreeSpace(tempDir, -1)).toThrow(
			'non-negative integer',
		)
		expect(() => assertBackupDirectoryFreeSpace(tempDir, 1.5)).toThrow(
			'non-negative integer',
		)
	})
})
