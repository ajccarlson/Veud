import { describe, expect, test } from 'vitest'
import {
	MINIMUM_PRODUCTION_SECRET_LENGTH,
	parseEnvironment,
} from './env.server.ts'

const strongSessionSecret = 's'.repeat(MINIMUM_PRODUCTION_SECRET_LENGTH)
const strongHoneypotSecret = 'h'.repeat(MINIMUM_PRODUCTION_SECRET_LENGTH)
const strongVerificationSecret = 'v'.repeat(MINIMUM_PRODUCTION_SECRET_LENGTH)
const strongInternalCommandToken = 'i'.repeat(MINIMUM_PRODUCTION_SECRET_LENGTH)

function productionEnvironment(
	overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
	return {
		NODE_ENV: 'production',
		DATABASE_PATH: 'prisma/data.db',
		DATABASE_URL: 'postgresql://example.invalid/veud',
		SESSION_SECRET: strongSessionSecret,
		VERIFICATION_SECRET_KEYS: '',
		INTERNAL_COMMAND_TOKEN: '',
		HONEYPOT_SECRET: strongHoneypotSecret,
		CACHE_DATABASE_PATH: 'other/cache.db',
		RESEND_API_KEY: '',
		TMDB_API_KEY: '',
		TRAKT_API_KEY: '',
		TRAKT_CLIENT_SECRET: '',
		TRAKT_ACCESS_TOKEN_MAIN: '',
		TRAKT_ACCESS_TOKEN_BACKUP: '',
		MAL_CLIENT_ID: '',
		MAL_CLIENT_SECRET: '',
		MAL_USER: '',
		ANILIST_CLIENT_ID: '',
		ANILIST_CLIENT_SECRET: '',
		...overrides,
	}
}

function fieldErrors(environment: NodeJS.ProcessEnv) {
	const result = parseEnvironment(environment)
	expect(result.success).toBe(false)
	if (result.success) throw new Error('Expected environment validation to fail')
	return result.error.flatten().fieldErrors
}

describe('environment cryptographic secrets', () => {
	test('accepts strong production secrets and deliberately blank providers', () => {
		expect(parseEnvironment(productionEnvironment()).success).toBe(true)
	})

	test.each([
		['empty', ''],
		['whitespace', '   '],
		['empty rotation entry', `${strongSessionSecret},`],
		['padded rotation entry', `${strongSessionSecret}, ${strongSessionSecret}`],
		['short production key', 'too-short'],
	])('rejects an %s session secret', (_label, SESSION_SECRET) => {
		expect(
			fieldErrors(productionEnvironment({ SESSION_SECRET })).SESSION_SECRET,
		).toBeDefined()
	})

	test('validates every production rotation key', () => {
		expect(
			fieldErrors(
				productionEnvironment({
					SESSION_SECRET: `${strongSessionSecret},short`,
				}),
			).SESSION_SECRET,
		).toBeDefined()
		expect(
			parseEnvironment(
				productionEnvironment({
					SESSION_SECRET: `${strongSessionSecret},${'r'.repeat(
						MINIMUM_PRODUCTION_SECRET_LENGTH,
					)}`,
				}),
			).success,
		).toBe(true)
	})

	test.each([
		['whitespace', '   '],
		['empty rotation entry', `${strongVerificationSecret},`],
		[
			'padded rotation entry',
			`${strongVerificationSecret}, ${strongVerificationSecret}`,
		],
		['short production key', 'too-short'],
	])(
		'rejects an %s configured verification secret',
		(_label, VERIFICATION_SECRET_KEYS) => {
			expect(
				fieldErrors(productionEnvironment({ VERIFICATION_SECRET_KEYS }))
					.VERIFICATION_SECRET_KEYS,
			).toBeDefined()
		},
	)

	test('allows a blank verification secret fallback and validates every configured key', () => {
		expect(
			parseEnvironment(productionEnvironment({ VERIFICATION_SECRET_KEYS: '' }))
				.success,
		).toBe(true)
		expect(
			fieldErrors(
				productionEnvironment({
					VERIFICATION_SECRET_KEYS: `${strongVerificationSecret},short`,
				}),
			).VERIFICATION_SECRET_KEYS,
		).toBeDefined()
		expect(
			parseEnvironment(
				productionEnvironment({
					VERIFICATION_SECRET_KEYS: `${strongVerificationSecret},${'r'.repeat(
						MINIMUM_PRODUCTION_SECRET_LENGTH,
					)}`,
				}),
			).success,
		).toBe(true)
	})

	test('allows disabled internal commands and requires a strong configured token', () => {
		expect(
			parseEnvironment(
				productionEnvironment({ INTERNAL_COMMAND_TOKEN: 'REDACTED' }),
			).success,
		).toBe(true)
		expect(
			fieldErrors(
				productionEnvironment({ INTERNAL_COMMAND_TOKEN: 'too-short' }),
			).INTERNAL_COMMAND_TOKEN,
		).toBeDefined()
		expect(
			fieldErrors(
				productionEnvironment({
					INTERNAL_COMMAND_TOKEN: ` ${strongInternalCommandToken}`,
				}),
			).INTERNAL_COMMAND_TOKEN,
		).toBeDefined()
		expect(
			parseEnvironment(
				productionEnvironment({
					INTERNAL_COMMAND_TOKEN: strongInternalCommandToken,
				}),
			).success,
		).toBe(true)
	})

	test.each([
		['empty', ''],
		['whitespace', '  '],
		['padded', ` ${strongHoneypotSecret}`],
		['short production value', 'too-short'],
	])('rejects an %s honeypot secret', (_label, HONEYPOT_SECRET) => {
		expect(
			fieldErrors(productionEnvironment({ HONEYPOT_SECRET })).HONEYPOT_SECRET,
		).toBeDefined()
	})

	test('allows short non-empty secrets outside production', () => {
		expect(
			parseEnvironment(
				productionEnvironment({
					NODE_ENV: 'test',
					SESSION_SECRET: 'test-session',
					VERIFICATION_SECRET_KEYS: 'test-verification',
					INTERNAL_COMMAND_TOKEN: 'test-internal-command',
					HONEYPOT_SECRET: 'test-honeypot',
				}),
			).success,
		).toBe(true)
	})
})

describe('cache database path', () => {
	test.each([
		['empty', ''],
		['whitespace-only', '   '],
		['leading whitespace', ' other/cache.db'],
		['trailing whitespace', 'other/cache.db '],
		['leading newline', '\nother/cache.db'],
	])('rejects an %s path', (_label, CACHE_DATABASE_PATH) => {
		expect(
			fieldErrors(productionEnvironment({ CACHE_DATABASE_PATH }))
				.CACHE_DATABASE_PATH,
		).toBeDefined()
	})

	test.each(['other/cache.db', '/var/lib/veud/cache.db', ':memory:'])(
		'accepts the nonblank path %s',
		CACHE_DATABASE_PATH => {
			expect(
				parseEnvironment(productionEnvironment({ CACHE_DATABASE_PATH }))
					.success,
			).toBe(true)
		},
	)
})
