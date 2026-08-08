import { expect, test } from 'vitest'
import {
	displayComment,
	REMOVED_COMMENT_BODY,
	reviewExcerpt,
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

test('the cut does not sever a surrogate pair', () => {
	// An emoji is two UTF-16 code units, so a cut at an odd offset inside one
	// leaves an orphaned half that renders as a black diamond.
	const body = `${'a'.repeat(REVIEW_EXCERPT_LENGTH - 1)}😀${'b'.repeat(100)}`
	const excerpt = reviewExcerpt(body)
	expect(excerpt.truncated).toBe(true)
	for (const unit of excerpt.text) {
		const code = unit.charCodeAt(0)
		// Nothing left over: every high surrogate still has its low half attached,
		// which iteration by code point would have already paired up.
		expect(code >= 0xd800 && code <= 0xdbff && unit.length === 1).toBe(false)
	}
})

test('a whole emoji at the boundary survives', () => {
	// One code unit earlier the pair fits, and cutting it would be a loss the
	// orphan guard must not cause.
	const body = `${'a'.repeat(REVIEW_EXCERPT_LENGTH - 2)}😀${'b'.repeat(100)}`
	expect(reviewExcerpt(body).text).toContain('😀')
})

test('a removed comment keeps its place and loses its body', () => {
	// The tombstone is the point: it says something was here, which is not the
	// same as nothing having been here.
	expect(
		displayComment({
			id: 'c1',
			body: 'what a moderator took down',
			moderationStatus: 'removed',
		}),
	).toEqual({ id: 'c1', body: REMOVED_COMMENT_BODY, isRemoved: true })
})

test('a visible comment passes through with its body', () => {
	expect(
		displayComment({ id: 'c2', body: 'ordinary', moderationStatus: 'visible' }),
	).toEqual({ id: 'c2', body: 'ordinary', isRemoved: false })
})

test('any status that is not visible is treated as removed', () => {
	// Nothing should have to enumerate the statuses a moderator can set for a
	// body to stay unpublished.
	for (const status of ['pending', 'hidden', 'flagged', '']) {
		const shown = displayComment({
			id: 'c',
			body: 'secret',
			moderationStatus: status,
		})
		expect(shown.isRemoved).toBe(true)
		expect(shown.body).toBe(REMOVED_COMMENT_BODY)
	}
})
