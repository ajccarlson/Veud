import { Prisma } from '@prisma/client'
import { expect, test } from 'vitest'
import { normalizeWatchlistEntryScores } from './watchlist-entry-scores.server.ts'

function entry(
	overrides: Partial<Parameters<typeof normalizeWatchlistEntryScores>[0]> = {},
) {
	return {
		id: 'entry-1',
		averaged: new Prisma.Decimal('7.25'),
		personal: new Prisma.Decimal('6.5'),
		differencePersonal: new Prisma.Decimal('-0.75'),
		differenceObjective: new Prisma.Decimal('-1.2'),
		tmdbScore: new Prisma.Decimal('7.7'),
		malScore: null,
		media: {
			kind: 'tv',
			tmdbScore: new Prisma.Decimal('7.9'),
			malScore: null,
		},
		trackingState: {
			status: 'watching',
			score: new Prisma.Decimal('8.1'),
		},
		...overrides,
	}
}

test('normalizes every watchlist Decimal into a browser-safe number', () => {
	const normalized = normalizeWatchlistEntryScores(entry())

	expect(normalized).toMatchObject({
		averaged: 7.25,
		personal: 8.1,
		differencePersonal: -0.75,
		differenceObjective: -1.2,
		tmdbScore: 7.9,
		malScore: null,
		media: { tmdbScore: 7.9, malScore: null },
		trackingState: { score: 8.1 },
	})
	expect(JSON.stringify(normalized)).not.toContain('SingleFetchClassInstance')
})

test('falls back to legacy entry scores while normalized records are absent', () => {
	const normalized = normalizeWatchlistEntryScores(
		entry({
			personal: new Prisma.Decimal('6.5'),
			tmdbScore: new Prisma.Decimal('7.7'),
			malScore: new Prisma.Decimal('8.2'),
			media: {
				kind: 'tv',
				tmdbScore: null,
				malScore: new Prisma.Decimal('0'),
			},
			trackingState: { status: 'watching', score: null },
		}),
	)

	expect(normalized.personal).toBe(6.5)
	expect(normalized.tmdbScore).toBe(7.7)
	expect(normalized.malScore).toBe(8.2)
})
