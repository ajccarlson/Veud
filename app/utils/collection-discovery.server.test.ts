import { expect, test } from 'vitest'
import {
	collectionTrendingScore,
	rankTrendingCollections,
	type TrendingCollectionSignals,
} from './collection-discovery.server.ts'

const now = new Date('2026-07-20T12:00:00.000Z')

function signals(
	id: string,
	overrides: Partial<TrendingCollectionSignals> = {},
): TrendingCollectionSignals {
	return {
		id,
		createdAt: new Date('2026-06-01T12:00:00.000Z'),
		updatedAt: new Date('2026-06-01T12:00:00.000Z'),
		likeCount: 0,
		commentCount: 0,
		recentLikes: [],
		recentComments: [],
		...overrides,
	}
}

test('trending ranking rewards recent engagement and publication freshness', () => {
	const recentLike = signals('recent-like', {
		recentLikes: [new Date('2026-07-20T10:00:00.000Z')],
		likeCount: 1,
	})
	const oldLike = signals('old-like', {
		recentLikes: [new Date('2026-06-21T12:00:00.000Z')],
		likeCount: 1,
	})
	const recentComment = signals('recent-comment', {
		recentComments: [new Date('2026-07-20T10:00:00.000Z')],
		commentCount: 1,
	})
	const newlyPublished = signals('newly-published', {
		createdAt: new Date('2026-07-20T11:00:00.000Z'),
		updatedAt: new Date('2026-07-20T11:00:00.000Z'),
	})

	expect(collectionTrendingScore(recentLike, now)).toBeGreaterThan(
		collectionTrendingScore(oldLike, now),
	)
	expect(rankTrendingCollections([oldLike, recentLike], now)[0]?.id).toBe(
		'recent-like',
	)
	expect(
		rankTrendingCollections(
			[oldLike, recentLike, recentComment, newlyPublished],
			now,
		).map(collection => collection.id),
	).toEqual(['recent-comment', 'newly-published', 'recent-like', 'old-like'])
})
