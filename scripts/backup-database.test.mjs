import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { expect, test } from 'vitest'

test('the one-shot backup worker exits non-zero after an early failure', async () => {
	const result = await execa('node', ['scripts/backup-database.mjs'], {
		env: {
			NODE_ENV: 'production',
			DATABASE_URL: 'postgresql://backup-test:unused@127.0.0.1:1/veud_test',
			POSTGRES_BACKUP_VERIFY_URL: '',
		},
		reject: false,
		timeout: 5_000,
	})

	expect(result.exitCode).toBe(1)
})

test('the backup worker refuses to guess which database it is protecting', async () => {
	// Falling through to the SQLite path here backs up a leftover file — or
	// nothing at all — while reporting success and leaving the real primary
	// unprotected.
	const result = await execa('node', ['scripts/backup-database.mjs'], {
		env: { NODE_ENV: 'production', DATABASE_URL: '' },
		reject: false,
		timeout: 10_000,
	})

	expect(result.exitCode).toBe(1)
	expect(result.stderr).toContain('DATABASE_URL must be set')
})

test('a development run still no-ops without needing a database url', async () => {
	const result = await execa('node', ['scripts/backup-database.mjs'], {
		env: { NODE_ENV: 'development', DATABASE_URL: '' },
		reject: false,
		timeout: 10_000,
	})

	expect(result.exitCode).toBe(0)
	expect(result.stdout).toContain('Skipping backup')
})

test('an hourly trigger steps aside when a backup is already running', async () => {
	// Two backups competing for the same directory is how a half-written
	// snapshot meets a pruner.
	const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veud-backup-lock-'))
	try {
		fs.writeFileSync(path.join(backupDir, '.backup.lock'), String(process.pid))
		const result = await execa('node', ['scripts/backup-database.mjs'], {
			env: {
				NODE_ENV: 'production',
				DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/veud_test',
				BACKUP_DIR: backupDir,
			},
			reject: false,
			timeout: 15_000,
		})
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('another backup is already running')
		// The running backup's lock survives the run that stepped aside.
		expect(fs.readFileSync(path.join(backupDir, '.backup.lock'), 'utf8')).toBe(
			String(process.pid),
		)
	} finally {
		fs.rmSync(backupDir, { recursive: true, force: true })
	}
})
