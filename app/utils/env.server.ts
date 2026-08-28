import { z } from 'zod'

const optionalBooleanFlag = z.enum(['true', 'false', '1', '0']).optional()
const optionalModel = z
	.string()
	.regex(
		/^\S+$/,
		'Model identifiers must be non-empty and contain no whitespace.',
	)
	.optional()
export const MINIMUM_PRODUCTION_SECRET_LENGTH = 32

const schema = z
	.object({
		NODE_ENV: z.enum(['production', 'development', 'test'] as const),
		DATABASE_PATH: z.string(),
		DATABASE_URL: z.string(),
		SESSION_SECRET: z.string(),
		VERIFICATION_SECRET_KEYS: z.string().optional(),
		INTERNAL_COMMAND_TOKEN: z.string(),
		HONEYPOT_SECRET: z.string(),
		CACHE_DATABASE_PATH: z
			.string()
			.min(1)
			.refine(
				value => value.trim().length > 0 && value === value.trim(),
				'CACHE_DATABASE_PATH must be non-empty and have no surrounding whitespace.',
			),
		// If you plan on using Sentry, uncomment this line
		// SENTRY_DSN: z.string(),
		// If you plan to use Resend, uncomment this line
		RESEND_API_KEY: z.string(),
		VEUD_ORIGIN: z
			.string()
			.url()
			.refine(value => ['http:', 'https:'].includes(new URL(value).protocol))
			.optional(),

		TMDB_API_KEY: z.string(),

		TRAKT_API_KEY: z.string(),
		TRAKT_CLIENT_SECRET: z.string(),
		TRAKT_ACCESS_TOKEN_MAIN: z.string(),
		TRAKT_ACCESS_TOKEN_BACKUP: z.string(),

		MAL_CLIENT_ID: z.string(),
		MAL_CLIENT_SECRET: z.string(),
		MAL_USER: z.string(),

		ANILIST_CLIENT_ID: z.string(),
		ANILIST_CLIENT_SECRET: z.string(),

		OPENAI_API_KEY: z.string().optional(),
		OPENAI_DEFAULT_MODEL: optionalModel,
		OPENAI_TIP_OF_TONGUE_MODEL: optionalModel,
		OPENAI_NATURAL_LANGUAGE_DISCOVERY_MODEL: optionalModel,
		OPENAI_DISCOVERY_REFINEMENT_MODEL: optionalModel,
		OPENAI_TRACKING_COMMAND_MODEL: optionalModel,
		OPENAI_IMAGE_TIP_OF_TONGUE_MODEL: optionalModel,
		OPENAI_IMPORT_RECONCILIATION_MODEL: optionalModel,
		OPENAI_REVIEW_ASSISTANCE_MODEL: optionalModel,
		OPENAI_MODERATION_TRIAGE_MODEL: optionalModel,
		VEUD_AI_ENABLED: optionalBooleanFlag,
		VEUD_AI_TIP_OF_TONGUE_ENABLED: optionalBooleanFlag,
		VEUD_AI_NATURAL_LANGUAGE_DISCOVERY_ENABLED: optionalBooleanFlag,
		VEUD_AI_DISCOVERY_REFINEMENT_ENABLED: optionalBooleanFlag,
		VEUD_AI_TRACKING_COMMAND_ENABLED: optionalBooleanFlag,
		VEUD_AI_IMAGE_TIP_OF_TONGUE_ENABLED: optionalBooleanFlag,
		VEUD_AI_IMPORT_RECONCILIATION_ENABLED: optionalBooleanFlag,
		VEUD_AI_REVIEW_ASSISTANCE_ENABLED: optionalBooleanFlag,
		VEUD_AI_MODERATION_TRIAGE_ENABLED: optionalBooleanFlag,
		VEUD_AI_MAX_CONCURRENCY: z
			.string()
			.regex(/^(?:[1-9]|1[0-9]|20)$/)
			.optional(),
		VEUD_AI_DAILY_LIMIT_PER_CAPABILITY: z
			.string()
			.regex(/^[1-9]\d{0,6}$/)
			.optional(),
		VEUD_AI_ANONYMOUS_DAILY_LIMIT_PER_CAPABILITY: z
			.string()
			.regex(/^[1-9]\d{0,6}$/)
			.optional(),
	})
	.superRefine((environment, context) => {
		function validateRotationSecret({
			name,
			value,
			allowEmpty,
		}: {
			name: 'SESSION_SECRET' | 'VERIFICATION_SECRET_KEYS'
			value: string | undefined
			allowEmpty: boolean
		}) {
			if (allowEmpty && (value === undefined || value === '')) return

			const secrets = (value ?? '').split(',')
			if (secrets.some(secret => !secret.trim() || secret !== secret.trim())) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [name],
					message: `Every ${name} rotation key must be non-empty and have no surrounding whitespace.`,
				})
			}
			if (
				environment.NODE_ENV === 'production' &&
				secrets.some(
					secret => secret.trim().length < MINIMUM_PRODUCTION_SECRET_LENGTH,
				)
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [name],
					message: `Every production ${name} rotation key must contain at least ${MINIMUM_PRODUCTION_SECRET_LENGTH} characters.`,
				})
			}
		}

		validateRotationSecret({
			name: 'SESSION_SECRET',
			value: environment.SESSION_SECRET,
			allowEmpty: false,
		})
		validateRotationSecret({
			name: 'VERIFICATION_SECRET_KEYS',
			value: environment.VERIFICATION_SECRET_KEYS,
			allowEmpty: true,
		})

		const internalCommandToken = environment.INTERNAL_COMMAND_TOKEN
		if (
			internalCommandToken &&
			internalCommandToken !== 'REDACTED' &&
			internalCommandToken !== internalCommandToken.trim()
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['INTERNAL_COMMAND_TOKEN'],
				message: 'INTERNAL_COMMAND_TOKEN must have no surrounding whitespace.',
			})
		}
		if (
			environment.NODE_ENV === 'production' &&
			internalCommandToken &&
			internalCommandToken !== 'REDACTED' &&
			internalCommandToken.trim().length < MINIMUM_PRODUCTION_SECRET_LENGTH
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['INTERNAL_COMMAND_TOKEN'],
				message: `An enabled production INTERNAL_COMMAND_TOKEN must contain at least ${MINIMUM_PRODUCTION_SECRET_LENGTH} characters.`,
			})
		}

		const honeypotSecret = environment.HONEYPOT_SECRET
		if (!honeypotSecret.trim() || honeypotSecret !== honeypotSecret.trim()) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['HONEYPOT_SECRET'],
				message:
					'HONEYPOT_SECRET must be non-empty and have no surrounding whitespace.',
			})
		}
		if (
			environment.NODE_ENV === 'production' &&
			honeypotSecret.trim().length < MINIMUM_PRODUCTION_SECRET_LENGTH
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['HONEYPOT_SECRET'],
				message: `Production HONEYPOT_SECRET must contain at least ${MINIMUM_PRODUCTION_SECRET_LENGTH} characters.`,
			})
		}
	})

declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof schema> {}
	}
}

export function init() {
	const parsed = parseEnvironment(process.env)

	if (parsed.success === false) {
		console.error(
			'❌ Invalid environment variables:',
			parsed.error.flatten().fieldErrors,
		)

		throw new Error('Invalid environment variables')
	}
}

export function parseEnvironment(environment: NodeJS.ProcessEnv) {
	return schema.safeParse(environment)
}

/**
 * This is used in both `entry.server.ts` and `root.tsx` to ensure that
 * the environment variables are set and globally available before the app is
 * started.
 *
 * NOTE: Do *not* add any environment variables in here that you do not wish to
 * be included in the client.
 * @returns all public ENV variables
 */
export function getEnv() {
	return {
		MODE: process.env.NODE_ENV,
		SENTRY_DSN: process.env.SENTRY_DSN,
		// The commit the browser is running. A crash report that cannot say which
		// release produced it takes a bisect to place.
		VEUD_RELEASE: process.env.VEUD_RELEASE,
	}
}

type ENV = ReturnType<typeof getEnv>

declare global {
	var ENV: ENV
	interface Window {
		ENV: ENV
	}
}
