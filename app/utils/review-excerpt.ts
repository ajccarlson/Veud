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
 *
 * Counted before moderation: a removed comment is rendered as a tombstone and
 * spends a slot like any other, so the page and the detail endpoint agree on
 * where the remainder begins.
 */
export const REVIEW_COMMENT_PREVIEW = 3

/**
 * How much of the remainder the detail endpoint will send.
 *
 * A review with ten thousand comments is not a reason to send ten thousand
 * comments, so the remainder is bounded too — and the caller is told when it
 * was, rather than being handed a short list that looks complete.
 */
export const REVIEW_COMMENT_REMAINDER_LIMIT = 200

/** What a reader sees where a moderator removed a comment. */
export const REMOVED_COMMENT_BODY = '[Removed by moderation]'

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
	// `slice` cuts at a UTF-16 code unit, which can land inside a surrogate pair
	// and leave an orphaned half that renders as a replacement character. Emoji
	// and anything outside the basic plane pay for that; dropping the orphan
	// costs one character. Whole grapheme clusters can still be split — a family
	// emoji can lose a member — but those render as themselves rather than as a
	// black diamond.
	const sliced = text.slice(0, limit)
	const hardCut = /[\uD800-\uDBFF]$/.test(sliced) ? sliced.slice(0, -1) : sliced
	const lastSpace = hardCut.lastIndexOf(' ')
	// Only honour a word boundary in the last fifth; earlier than that and the
	// excerpt loses more than the ragged edge was worth.
	const cut = lastSpace > limit * 0.8 ? hardCut.slice(0, lastSpace) : hardCut
	return { text: `${cut.trimEnd()}…`, truncated: true }
}

/**
 * A comment as a reader sees it.
 *
 * A removed comment keeps its place and loses its body: the tombstone tells a
 * reader that something was there, which is not the same as it never having
 * existed. Both the media page and the detail endpoint go through here, so the
 * two cannot drift apart on what a removed comment looks like — or on whether
 * it occupies a slot.
 */
export function displayComment<
	T extends { body: string; moderationStatus: string },
>({
	moderationStatus,
	...comment
}: T): Omit<T, 'moderationStatus'> & { isRemoved: boolean } {
	const isRemoved = moderationStatus !== 'visible'
	return {
		...comment,
		body: isRemoved ? REMOVED_COMMENT_BODY : comment.body,
		isRemoved,
	}
}
