import { expect, test } from 'vitest'
import {
	assertProductionDatabaseUrl,
	replaceEnvironmentValues,
} from './production-environment-utils.mjs'

test('replaces only allowlisted environment values and preserves formatting', () => {
	const source = [
		'# retained',
		'DATABASE_URL=file:./prisma/data.db',
		'export BACKUP_KEEP = 12',
		'UNRELATED=\"keep me\"',
		'',
	].join('\n')

	expect(
		replaceEnvironmentValues(source, {
			DATABASE_URL: 'postgresql://user:password@127.0.0.1:5433/veud_production',
			BACKUP_KEEP: '48',
			BACKUP_DIR: '/media/sde/veud-production/backups',
		}),
	).toBe(
		[
			'# retained',
			'DATABASE_URL=\"postgresql://user:password@127.0.0.1:5433/veud_production\"',
			'export BACKUP_KEEP =\"48\"',
			'UNRELATED=\"keep me\"',
			'',
			'BACKUP_DIR=\"/media/sde/veud-production/backups\"',
		].join('\n'),
	)
})

test('rejects an unexpected production database URL', () => {
	expect(() =>
		assertProductionDatabaseUrl(
			'postgresql://user:password@127.0.0.1:5433/veud_production',
		),
	).not.toThrow()
	expect(() =>
		assertProductionDatabaseUrl(
			'postgresql://user:password@127.0.0.1:5433/veud_staging',
		),
	).toThrow('unexpected production database')
})
