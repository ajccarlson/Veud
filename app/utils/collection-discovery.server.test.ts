import { expect, test } from 'vitest'
import {
	collectionTrendingScore,
	personalizedCollectionScore,
	rankPersonalizedCollections,
	rankTrendingCollections,
	type PersonalizedCollectionSignals,
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

function personalizedSignals(
	id: string,
	overrides: Partial<PersonalizedCollectionSignals> = {},
): PersonalizedCollectionSignals {
	return {
		id,
		ownerId: `${id}-owner`,
		updatedAt: now,
		likeCount: 0,
		commentCount: 0,
		itemIds: [],
		tags: [],
		...overrides,
	}
}

test('personalized ranking explains follows, title overlap, and liked tags', () => {
	const taste = {
		followedOwnerIds: new Set(['followed-owner']),
		mediaWeights: new Map([['favorite-media', 8]]),
		tagWeights: new Map([['space-opera', 4]]),
	}
	const followed = personalizedSignals('followed', {
		ownerId: 'followed-owner',
	})
	const titleMatch = personalizedSignals('title-match', {
		itemIds: ['favorite-media'],
	})
	const tagMatch = personalizedSignals('tag-match', {
		tags: [{ name: 'space opera', slug: 'space-opera' }],
	})
	const popular = personalizedSignals('popular', { likeCount: 100 })

	expect(
		rankPersonalizedCollections(
			[popular, tagMatch, titleMatch, followed],
			taste,
			now,
		).map(item => item.id),
	).toEqual(['followed', 'title-match', 'tag-match', 'popular'])
	expect(personalizedCollectionScore(followed, taste, now).reason).toBe(
		'From someone you follow',
	)
	expect(personalizedCollectionScore(titleMatch, taste, now).reason).toBe(
		'Includes a title you enjoyed',
	)
	expect(personalizedCollectionScore(tagMatch, taste, now).reason).toBe(
		'Matches #space opera from collections you liked',
	)
})
