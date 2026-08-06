import { expect, test } from 'vitest'
import {
	hiddenCommentCount,
	reviewExcerpt,
	REVIEW_COMMENT_PREVIEW,
	REVIEW_EXCERPT_LENGTH,
} from './review-excerpt.ts'

test('a short review is sent whole and not marked truncated', () => {
	expect(reviewExcerpt('Short and complete.')).toEqual({
		text: 'Short and complete.',
		truncated: false,
	})
	// Exactly at the limit is still whole; the cut begins past it.
	const exact = 'x'.repeat(REVIEW_EXCERPT_LENGTH)
	expect(reviewExcerpt(exact)).toEqual({ text: exact, truncated: false })
})

test('a long review is cut and says so', () => {
	const body = 'word '.repeat(400)
	const excerpt = reviewExcerpt(body)
	expect(excerpt.truncated).toBe(true)
	expect(excerpt.text.length).toBeLessThanOrEqual(REVIEW_EXCERPT_LENGTH + 1)
	expect(excerpt.text.endsWith('…')).toBe(true)
})

test('the cut lands on a word boundary when one is near', () => {
	const body = `${'a'.repeat(590)} boundary ${'b'.repeat(200)}`
	const excerpt = reviewExcerpt(body)
	// Not mid-word: the character before the ellipsis is not a letter that was
	// severed from its other half.
	expect(excerpt.text).not.toMatch(/b…$/)
})

test('text with nothing to break on is still cut', () => {
	// A word boundary too early would lose more than the ragged edge is worth.
	const body = 'x'.repeat(2_000)
	const excerpt = reviewExcerpt(body)
	expect(excerpt.truncated).toBe(true)
	expect(excerpt.text).toHaveLength(REVIEW_EXCERPT_LENGTH + 1)
})

test('an absent body is not an error', () => {
	expect(reviewExcerpt(null)).toEqual({ text: '', truncated: false })
	expect(reviewExcerpt(undefined)).toEqual({ text: '', truncated: false })
	expect(reviewExcerpt('')).toEqual({ text: '', truncated: false })
})

test('the hidden comment count is what the page did not send', () => {
	expect(hiddenCommentCount(50)).toBe(50 - REVIEW_COMMENT_PREVIEW)
	expect(hiddenCommentCount(REVIEW_COMMENT_PREVIEW)).toBe(0)
	expect(hiddenCommentCount(1)).toBe(0)
	expect(hiddenCommentCount(0)).toBe(0)
	// Never negative, whatever it is handed.
	expect(hiddenCommentCount(-5)).toBe(0)
	expect(hiddenCommentCount(Number.NaN)).toBe(0)
})
