import { describe, expect, test } from 'vitest'
import { assertMigrationParity } from './postgres-backup-operations.mjs'

describe('PostgreSQL backup migration parity', () => {
	test('accepts a restore that exactly matches its source database', () => {
		expect(() =>
			assertMigrationParity(
				['migration-1', 'migration-2'],
				['migration-1', 'migration-2'],
			),
		).not.toThrow()
	})

	test('accepts a source that intentionally predates the current checkout', () => {
		expect(() =>
			assertMigrationParity(['migration-1'], ['migration-1']),
		).not.toThrow()
	})

	test('rejects a restore that omitted a source migration', () => {
		expect(() =>
			assertMigrationParity(['migration-1', 'migration-2'], ['migration-1']),
		).toThrow('missing from restore: migration-2')
	})

	test('rejects migration history that was not present in the source', () => {
		expect(() =>
			assertMigrationParity(
				['migration-1'],
				['migration-1', 'migration-unexpected'],
			),
		).toThrow('not present in source: migration-unexpected')
	})
})
