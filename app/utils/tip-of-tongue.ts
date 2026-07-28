export type TipOfTongueSource = 'ai' | 'catalog-match' | null

export type TipOfTongueFallbackReason =
	| 'not-configured'
	| 'sign-in-required'
	| 'rate-limited'
	| 'ai-unavailable'
	| 'ai-error'
	| 'ai-empty'
	| null

export function tipOfTongueStatus({
	source,
	fallbackReason,
}: {
	source: TipOfTongueSource
	fallbackReason: TipOfTongueFallbackReason
}) {
	if (source === 'ai') return 'AI match'
	switch (fallbackReason) {
		case 'rate-limited':
			return 'Local match · AI limit reached'
		case 'ai-unavailable':
		case 'ai-error':
			return 'Local match · AI unavailable'
		default:
			return 'Local match'
	}
}
