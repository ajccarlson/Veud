export const REVIEW_MAX_LENGTH = 5_000
export const REVIEW_COMMENT_MAX_LENGTH = 1_000

export function parseDiaryDate(value: string) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	if (!match) return null
	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const date = new Date(Date.UTC(year, month - 1, day))
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null
	}
	return date
}

export function journalTerms(mediaKind: string) {
	const reading = mediaKind === 'manga'
	return reading
		? { action: 'read', repeat: 'Reread', past: 'Read' }
		: { action: 'watch', repeat: 'Rewatch', past: 'Watched' }
}
