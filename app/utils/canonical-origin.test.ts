import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	canonicalOriginFromEnvironment,
	getCanonicalOrigin,
} from './canonical-origin.ts'

afterEach(() => vi.unstubAllEnvs())

describe('canonical application origin', () => {
	test('uses the configured HTTP origin without paths or trailing slashes', () => {
		expect(
			canonicalOriginFromEnvironment({
				NODE_ENV: 'production',
				VEUD_ORIGIN: 'https://staging.veud.net/path/',
			}),
		).toBe('https://staging.veud.net')
	})

	test('uses the Veud production origin instead of a forged request host', () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.stubEnv('VEUD_ORIGIN', '')
		const request = new Request('https://attacker.example/reset-password', {
			headers: {
				host: 'attacker.example',
				'X-Forwarded-Host': 'attacker.example',
			},
		})

		expect(getCanonicalOrigin(request)).toBe('https://veud.net')
	})

	test('allows local request origins outside production', () => {
		vi.stubEnv('NODE_ENV', 'test')
		vi.stubEnv('VEUD_ORIGIN', '')
		const request = new Request('http://localhost:4022/verify', {
			headers: { host: 'localhost:4022' },
		})

		expect(getCanonicalOrigin(request)).toBe('http://localhost:4022')
	})
})
