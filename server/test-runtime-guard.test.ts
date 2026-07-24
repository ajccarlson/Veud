import { describe, expect, test } from 'vitest'
import { assertSafeMockProductionRuntime } from './test-runtime-guard.ts'

describe('production mock runtime guard', () => {
	test('allows ordinary production and development runtimes', () => {
		expect(() =>
			assertSafeMockProductionRuntime({ NODE_ENV: 'production' }),
		).not.toThrow()
		expect(() =>
			assertSafeMockProductionRuntime({
				NODE_ENV: 'development',
				MOCKS: 'true',
			}),
		).not.toThrow()
	})

	test('requires an explicit test marker', () => {
		expect(() =>
			assertSafeMockProductionRuntime({
				NODE_ENV: 'production',
				MOCKS: 'true',
				DATABASE_URL: 'file:/workspace/tests/prisma/playwright.db',
			}),
		).toThrow('VEUD_E2E=1')
	})

	test('rejects a non-test or non-SQLite database', () => {
		const base = {
			NODE_ENV: 'production',
			MOCKS: 'true',
			VEUD_E2E: '1',
		}
		expect(() =>
			assertSafeMockProductionRuntime({
				...base,
				DATABASE_URL: 'postgresql://localhost/veud',
			}),
		).toThrow('disposable SQLite')
		expect(() =>
			assertSafeMockProductionRuntime(
				{ ...base, DATABASE_URL: 'file:/workspace/prisma/data.db' },
				'/workspace',
			),
		).toThrow('tests/prisma')
	})

	test('accepts a disposable database under tests/prisma', () => {
		expect(() =>
			assertSafeMockProductionRuntime(
				{
					NODE_ENV: 'production',
					MOCKS: 'true',
					VEUD_E2E: '1',
					DATABASE_URL:
						'file:/workspace/tests/prisma/playwright.db?connection_limit=1',
				},
				'/workspace',
			),
		).not.toThrow()
	})
})
