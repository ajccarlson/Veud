import { describe, expect, test } from 'vitest'
import { assertSafeMockProductionRuntime } from './test-runtime-guard.ts'

describe('production mock runtime guard', () => {
	test('allows ordinary production and development runtimes', () => {
		expect(assertSafeMockProductionRuntime({ NODE_ENV: 'production' })).toBe(
			false,
		)
		expect(
			assertSafeMockProductionRuntime({
				NODE_ENV: 'development',
				MOCKS: 'true',
				PLAYWRIGHT_TEST_BASE_URL: 'https://not-loopback.example',
			}),
		).toBe(false)
	})

	test.each([
		{
			name: 'no markers',
			mocks: false,
			e2e: false,
			playwright: false,
			expected: false,
		},
		{
			name: 'Playwright only',
			mocks: false,
			e2e: false,
			playwright: true,
			error: 'MOCKS=true',
		},
		{
			name: 'E2E only',
			mocks: false,
			e2e: true,
			playwright: false,
			expected: false,
		},
		{
			name: 'E2E and Playwright',
			mocks: false,
			e2e: true,
			playwright: true,
			error: 'MOCKS=true',
		},
		{
			name: 'mocks only',
			mocks: true,
			e2e: false,
			playwright: false,
			error: 'VEUD_E2E=1',
		},
		{
			name: 'mocks and Playwright',
			mocks: true,
			e2e: false,
			playwright: true,
			error: 'VEUD_E2E=1',
		},
		{
			name: 'mocks and E2E',
			mocks: true,
			e2e: true,
			playwright: false,
			expected: true,
		},
		{
			name: 'all markers',
			mocks: true,
			e2e: true,
			playwright: true,
			expected: true,
		},
	])(
		'requires a complete safe marker combination: $name',
		({ mocks, e2e, playwright, expected, error }) => {
			const env = {
				NODE_ENV: 'production',
				MOCKS: mocks ? 'true' : undefined,
				VEUD_E2E: e2e ? '1' : undefined,
				PLAYWRIGHT_TEST_BASE_URL: playwright
					? 'http://localhost:4022'
					: undefined,
				DATABASE_URL: 'file:/workspace/tests/prisma/playwright.db',
			}
			if (error) {
				expect(() =>
					assertSafeMockProductionRuntime(env, '/workspace'),
				).toThrow(error)
			} else {
				expect(assertSafeMockProductionRuntime(env, '/workspace')).toBe(
					expected,
				)
			}
		},
	)

	test('does not treat disabled marker values as a test runtime', () => {
		expect(
			assertSafeMockProductionRuntime({
				NODE_ENV: 'production',
				MOCKS: 'false',
				VEUD_E2E: '0',
			}),
		).toBe(false)
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

	test.each([
		'http://localhost:4022',
		'https://localhost',
		'http://127.0.0.1:4022',
		'http://127.255.255.254',
		'http://[::1]:4022',
	])('accepts a loopback Playwright base URL: %s', baseUrl => {
		expect(
			assertSafeMockProductionRuntime(
				{
					NODE_ENV: 'production',
					MOCKS: 'true',
					VEUD_E2E: '1',
					PLAYWRIGHT_TEST_BASE_URL: baseUrl,
					DATABASE_URL:
						'file:/workspace/tests/prisma/playwright.db?connection_limit=1',
				},
				'/workspace',
			),
		).toBe(true)
	})

	test.each([
		'https://example.com',
		'http://localhost.example.com',
		'http://127.example.com',
		'http://0.0.0.0:4022',
		'ws://localhost:4022',
		'not a URL',
	])('rejects a non-loopback Playwright base URL: %s', baseUrl => {
		expect(() =>
			assertSafeMockProductionRuntime(
				{
					NODE_ENV: 'production',
					MOCKS: 'true',
					VEUD_E2E: '1',
					PLAYWRIGHT_TEST_BASE_URL: baseUrl,
					DATABASE_URL: 'file:/workspace/tests/prisma/playwright.db',
				},
				'/workspace',
			),
		).toThrow('loopback HTTP(S)')
	})
})
