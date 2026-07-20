import { expect, test } from 'vitest'
import {
	parseReviewDiscoveryQuery,
	rankTrendingReviews,
	reviewTrendingScore,
	type TrendingReviewSignals,
} from './review-discovery.server.ts'

const now = new Date('2026-07-20T12:00:00.000Z')

function signals(
	id: string,
	overrides: Partial<TrendingReviewSignals> = {},
): TrendingReviewSignals {
	return {
		id,
		createdAt: new Date('2026-06-01T12:00:00.000Z'),
		likeCount: 0,
		commentCount: 0,
		recentLikes: [],
		recentComments: [],
		...overrides,
	}
}

test('review discovery query parsing bounds and normalizes filters', () => {
	expect(
		parseReviewDiscoveryQuery(
			new URLSearchParams({
				q: `  ${'r'.repeat(120)}  `,
				kind: 'podcast',
				sort: 'controversial',
				spoilers: 'never',
				page: '-3',
			}),
		),
	).toEqual({
		q: 'r'.repeat(100),
		kind: 'all',
		sort: 'trending',
		spoilers: 'include',
		page: 1,
	})
})

test('trending reviews reward recent discussion and decay old engagement', () => {
	const recentComment = signals('recent-comment', {
		commentCount: 1,
		recentComments: [new Date('2026-07-20T10:00:00.000Z')],
	})
	const recentLike = signals('recent-like', {
		likeCount: 1,
		recentLikes: [new Date('2026-07-20T10:00:00.000Z')],
	})
	const oldLikes = signals('old-likes', {
		likeCount: 2,
		recentLikes: [
			new Date('2026-06-21T12:00:00.000Z'),
			new Date('2026-06-21T12:00:00.000Z'),
		],
	})
	const newReview = signals('new-review', {
		createdAt: new Date('2026-07-20T11:00:00.000Z'),
	})

	expect(reviewTrendingScore(recentLike, now)).toBeGreaterThan(
		reviewTrendingScore(oldLikes, now),
	)
	expect(
		rankTrendingReviews(
			[oldLikes, recentLike, newReview, recentComment],
			now,
		).map(review => review.id),
	).toEqual(['recent-comment', 'new-review', 'recent-like', 'old-likes'])
})
