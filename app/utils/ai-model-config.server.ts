export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna'

export const aiCapabilities = [
	'tip-of-tongue',
	'natural-language-discovery',
	'discovery-refinement',
	'tracking-command',
	'image-tip-of-tongue',
	'import-reconciliation',
	'review-assistance',
	'moderation-triage',
] as const

export type AiCapability = (typeof aiCapabilities)[number]

const capabilityModelEnvironmentKeys = {
	'tip-of-tongue': 'OPENAI_TIP_OF_TONGUE_MODEL',
	'natural-language-discovery': 'OPENAI_NATURAL_LANGUAGE_DISCOVERY_MODEL',
	'discovery-refinement': 'OPENAI_DISCOVERY_REFINEMENT_MODEL',
	'tracking-command': 'OPENAI_TRACKING_COMMAND_MODEL',
	'image-tip-of-tongue': 'OPENAI_IMAGE_TIP_OF_TONGUE_MODEL',
	'import-reconciliation': 'OPENAI_IMPORT_RECONCILIATION_MODEL',
	'review-assistance': 'OPENAI_REVIEW_ASSISTANCE_MODEL',
	'moderation-triage': 'OPENAI_MODERATION_TRIAGE_MODEL',
} as const satisfies Record<AiCapability, keyof NodeJS.ProcessEnv>

export function modelFor(
	capability: AiCapability,
	fallback = DEFAULT_OPENAI_MODEL,
	environment: NodeJS.ProcessEnv = process.env,
) {
	return (
		environment[capabilityModelEnvironmentKeys[capability]]?.trim() ||
		environment.OPENAI_DEFAULT_MODEL?.trim() ||
		fallback
	)
}

export function isAiCapabilityConfigured(
	capability: AiCapability,
	environment: NodeJS.ProcessEnv = process.env,
) {
	const capabilityFlag = `VEUD_AI_${capability
		.replaceAll('-', '_')
		.toUpperCase()}_ENABLED`
	return Boolean(
		environment.OPENAI_API_KEY?.trim() &&
		!['0', 'false'].includes(
			environment.VEUD_AI_ENABLED?.trim().toLowerCase() ?? 'true',
		) &&
		!['0', 'false'].includes(
			environment[capabilityFlag]?.trim().toLowerCase() ?? 'true',
		),
	)
}
