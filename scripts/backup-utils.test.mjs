import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
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

		expect(() =>
			verifyBackupDatabase(backupPath, verificationOptions),
		).toThrow('foreign key check failed')
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
		fs.utimesSync(path.join(offsiteDir, 'data-old.db'), new Date(0), new Date(0))

		expect(pruneBackups(offsiteDir, 1)).toEqual(['data-old.db'])
		expect(fs.existsSync(destination)).toBe(true)
		expect(fs.existsSync(path.join(offsiteDir, 'keep-me.txt'))).toBe(true)
	})

	test('rejects invalid retention instead of pruning every backup', () => {
		expect(() => parsePositiveInteger('not-a-number', 48, 'BACKUP_KEEP')).toThrow(
			'BACKUP_KEEP must be a positive integer',
		)
		expect(parsePositiveInteger(undefined, 48, 'BACKUP_KEEP')).toBe(48)
	})
})
