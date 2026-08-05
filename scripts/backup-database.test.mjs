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
