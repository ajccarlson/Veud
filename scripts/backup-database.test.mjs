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
