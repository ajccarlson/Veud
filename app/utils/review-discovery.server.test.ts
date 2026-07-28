import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	getReviewDiscoveryResults,
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

test('review discovery matches mixed-case text, members, and media aliases', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const author = await prisma.user.create({
		data: {
			email: `review_case_${suffix}@example.com`,
			username: `CaseReviewer_${suffix}`,
			name: `Mixed Member ${suffix}`,
		},
	})
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: `Canonical Review Film ${suffix}`,
			titles: {
				create: {
					provider: 'tmdb',
					language: 'en',
					titleType: 'alternate',
					value: `Secret Review Alias ${suffix}`,
					normalized: `secret review alias ${suffix}`,
				},
			},
		},
	})
	const review = await prisma.review.create({
		data: {
			authorId: author.id,
			mediaId: media.id,
			body: `An UnFoRgEtTaBlE observation ${suffix}`,
		},
	})
	const search = (q: string) =>
		getReviewDiscoveryResults(
			parseReviewDiscoveryQuery(
				new URLSearchParams({ q, sort: 'recent', kind: 'movie' }),
			),
			null,
		)

	for (const query of [
		`uNfOrGeTtAbLe ObSeRvAtIoN ${suffix.toUpperCase()}`,
		`cAsErEvIeWeR_${suffix.toUpperCase()}`,
		`cAnOnIcAl ReViEw FiLm ${suffix.toUpperCase()}`,
		`SeCrEt ReViEw AlIaS ${suffix.toUpperCase()}`,
	]) {
		const result = await search(query)
		expect(result.items.map(item => item.id)).toEqual([review.id])
	}
})
