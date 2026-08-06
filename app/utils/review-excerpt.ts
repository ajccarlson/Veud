/**
 * How much of a review the media page sends before asking.
 *
 * Reviews can run to 5,000 characters and the page lists twenty of them, so
 * sending every body in full spends 100 KB on text most visitors never scroll
 * to. The excerpt is long enough to judge whether a review is worth opening,
 * which is what a list of reviews is for.
 */
export const REVIEW_EXCERPT_LENGTH = 600

/**
 * How many comments travel with each review.
 *
 * Fifty per review across twenty reviews is a thousand comments on a page
 * nobody opened to read comments. A few is enough to show a conversation
 * exists.
 */
export const REVIEW_COMMENT_PREVIEW = 3

export type ReviewExcerpt = {
	text: string
	truncated: boolean
}

/**
 * Cut at a word boundary when there is one nearby, so the excerpt does not end
 * mid-word. Falls back to a hard cut for text with no spaces to break on.
 */
export function reviewExcerpt(
	body: string | null | undefined,
	limit = REVIEW_EXCERPT_LENGTH,
): ReviewExcerpt {
	const text = body ?? ''
	if (text.length <= limit) return { text, truncated: false }
	const hardCut = text.slice(0, limit)
	const lastSpace = hardCut.lastIndexOf(' ')
	// Only honour a word boundary in the last fifth; earlier than that and the
	// excerpt loses more than the ragged edge was worth.
	const cut = lastSpace > limit * 0.8 ? hardCut.slice(0, lastSpace) : hardCut
	return { text: `${cut.trimEnd()}…`, truncated: true }
}

/** How many comments remain unsent for a review. */
export function hiddenCommentCount(
	total: number,
	shown = REVIEW_COMMENT_PREVIEW,
) {
	if (!Number.isFinite(total) || total <= 0) return 0
	return Math.max(0, Math.trunc(total) - shown)
}
