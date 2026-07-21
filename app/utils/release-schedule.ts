/**
 * Preserve the distinction between an authoritative empty provider response
 * (`null`) and a provider request that did not complete (`undefined`).
 */
export function serializeNextRelease(
	value: unknown,
): string | null | undefined {
	if (value === undefined) return undefined
	if (value === null) return null
	return JSON.stringify(value)
}
