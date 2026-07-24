import { z } from 'zod'

const optionalBooleanFlag = z.enum(['true', 'false', '1', '0']).optional()

const schema = z.object({
	NODE_ENV: z.enum(['production', 'development', 'test'] as const),
	DATABASE_PATH: z.string(),
	DATABASE_URL: z.string(),
	SESSION_SECRET: z.string(),
	INTERNAL_COMMAND_TOKEN: z.string(),
	HONEYPOT_SECRET: z.string(),
	CACHE_DATABASE_PATH: z.string(),
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
	OPENAI_TIP_OF_TONGUE_MODEL: z.string().optional(),
	OPENAI_DEFAULT_MODEL: z.string().optional(),
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
})

declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof schema> {}
	}
}

export function init() {
	const parsed = schema.safeParse(process.env)

	if (parsed.success === false) {
		console.error(
			'❌ Invalid environment variables:',
			parsed.error.flatten().fieldErrors,
		)

		throw new Error('Invalid environment variables')
	}
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
	}
}

type ENV = ReturnType<typeof getEnv>

declare global {
	var ENV: ENV
	interface Window {
		ENV: ENV
	}
}
