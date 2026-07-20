import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	getDiscoveryGenres,
	getDiscoveryResults,
	getDiscoveryStatuses,
	parseDiscoveryQuery,
} from './discovery.server.ts'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

function filters(
	overrides: Partial<ReturnType<typeof parseDiscoveryQuery>> = {},
) {
	return {
		q: '',
		kind: 'all' as const,
		genre: '',
		year: null,
		status: '',
		provider: 'all' as const,
		sort: 'popular' as const,
		page: 1,
		...overrides,
	}
}

test('discovery query parsing bounds input and replaces invalid options', () => {
	const parsed = parseDiscoveryQuery(
		new URLSearchParams({
			q: `  ${'a'.repeat(120)}  `,
			kind: 'podcast',
			genre: '  Drama  ',
			year: '1700',
			provider: 'other',
			sort: 'random',
			page: '-4',
		}),
	)

	expect(parsed).toEqual({
		q: 'a'.repeat(100),
		kind: 'all',
		genre: 'Drama',
		year: null,
		status: '',
		provider: 'all',
		sort: 'popular',
		page: 1,
	})
})

test('discovery searches alternate titles and filters year, status, and provider', async () => {
	const tmdb = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'The Journey',
			releaseStart: new Date('2026-03-01T00:00:00.000Z'),
			releaseStatus: 'Released',
			catalogPopularity: 100,
			externalIds: {
				create: { provider: 'tmdb', kind: 'movie', externalId: '800' },
			},
			titles: {
				create: {
					provider: 'tmdb',
					language: 'fr',
					titleType: 'alternate',
					value: 'Le Voyage',
					normalized: 'le voyage',
				},
			},
		},
	})
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'The Journey Elsewhere',
			releaseStart: new Date('2025-03-01T00:00:00.000Z'),
			releaseStatus: 'Released',
			externalIds: {
				create: { provider: 'mal', kind: 'movie', externalId: '801' },
			},
		},
	})

	const result = await getDiscoveryResults(
		filters({
			q: 'voyagé',
			kind: 'movie',
			year: 2026,
			status: 'Released',
			provider: 'tmdb',
		}),
		null,
	)

	expect(result.items).toEqual([
		expect.objectContaining({
			id: tmdb.id,
			title: 'The Journey',
			matchedTitle: 'Le Voyage',
			year: '2026',
			releaseStatus: 'Released',
			providers: ['tmdb'],
		}),
	])
	expect(await getDiscoveryStatuses()).toEqual(['Released'])
})

test('discovery searches canonical metadata and exposes normalized genres', async () => {
	await prisma.media.createMany({
		data: [
			{
				kind: 'movie',
				title: 'Signal from Orbit',
				genres: 'Science Fiction, Drama',
				description: 'A lonely astronaut receives a mysterious transmission.',
			},
			{
				kind: 'anime',
				title: 'Garden Notes',
				genres: 'Drama, Slice of Life',
				description: 'A quiet summer in the countryside.',
			},
			{ kind: 'movie', title: 'Action Exact', genres: 'Action' },
			{ kind: 'movie', title: 'Behind the Camera', genres: 'Live Action' },
		],
	})

	const result = await getDiscoveryResults(
		filters({ q: 'transmission', kind: 'movie', genre: 'Science Fiction' }),
		null,
	)

	expect(result.items.map(item => item.title)).toEqual(['Signal from Orbit'])
	expect(result.total).toBe(1)
	const action = await getDiscoveryResults(filters({ genre: 'Action' }), null)
	expect(action.items.map(item => item.title)).toEqual(['Action Exact'])
	expect(await getDiscoveryGenres()).toEqual([
		'Action',
		'Drama',
		'Live Action',
		'Science Fiction',
		'Slice of Life',
	])
})

test('top-rated ranking tempers sparse scores and title pagination is stable', async () => {
	const [firstRater, secondRater, thirdRater] = await Promise.all([
		createUser('first_rater'),
		createUser('second_rater'),
		createUser('third_rater'),
	])
	const [established, sparse] = await Promise.all([
		prisma.media.create({
			data: { kind: 'movie', title: 'Established Nine' },
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Sparse Ten' },
		}),
	])
	await prisma.trackingState.createMany({
		data: [
			{
				ownerId: firstRater.id,
				mediaId: established.id,
				status: 'completed',
				score: 9,
			},
			{
				ownerId: secondRater.id,
				mediaId: established.id,
				status: 'completed',
				score: 9,
			},
			{
				ownerId: thirdRater.id,
				mediaId: sparse.id,
				status: 'completed',
				score: 10,
			},
		],
	})

	const rated = await getDiscoveryResults(filters({ sort: 'top-rated' }), null)
	expect(rated.items.map(item => item.title)).toEqual([
		'Established Nine',
		'Sparse Ten',
	])

	await prisma.media.createMany({
		data: Array.from({ length: 25 }, (_, index) => ({
			kind: 'anime',
			title: `Paged ${String(index + 1).padStart(2, '0')}`,
		})),
	})
	const secondPage = await getDiscoveryResults(
		filters({ kind: 'anime', sort: 'title', page: 2 }),
		null,
	)
	expect(secondPage.total).toBe(25)
	expect(secondPage.pageCount).toBe(2)
	expect(secondPage.items.map(item => item.title)).toEqual(['Paged 25'])
})

test('private-list tracking stays personal and does not affect discovery aggregates', async () => {
	const [publicMember, privateMember] = await Promise.all([
		createUser('public_discovery_member'),
		createUser('private_discovery_member'),
	])
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const listType = await prisma.listType.create({
		data: {
			name: `discovery-privacy-${suffix}`,
			header: 'Discovery privacy',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
	})
	const [publicList, privateList, publicTitle, privateTitle] =
		await Promise.all([
			prisma.watchlist.create({
				data: {
					ownerId: publicMember.id,
					typeId: listType.id,
					name: 'public',
					header: 'Public',
					isPublic: true,
				},
			}),
			prisma.watchlist.create({
				data: {
					ownerId: privateMember.id,
					typeId: listType.id,
					name: 'private',
					header: 'Private',
					isPublic: false,
				},
			}),
			prisma.media.create({
				data: { kind: 'movie', title: 'Discovery Privacy Public Eight' },
			}),
			prisma.media.create({
				data: { kind: 'movie', title: 'Discovery Privacy Private Ten' },
			}),
		])
	await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: publicMember.id,
				mediaId: publicTitle.id,
				status: 'completed',
				statusWatchlistId: publicList.id,
				score: 8,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: privateMember.id,
				mediaId: privateTitle.id,
				status: 'completed',
				statusWatchlistId: privateList.id,
				score: 10,
			},
		}),
	])

	const topRated = await getDiscoveryResults(
		filters({ q: 'Discovery Privacy', sort: 'top-rated' }),
		null,
	)
	expect(topRated.items.map(item => item.id)).toEqual([publicTitle.id])

	const ownerView = await getDiscoveryResults(
		filters({ q: 'Discovery Privacy', sort: 'title' }),
		privateMember.id,
	)
	const privateResult = ownerView.items.find(
		item => item.id === privateTitle.id,
	)
	expect(privateResult).toEqual(
		expect.objectContaining({
			communityScore: null,
			ratingCount: 0,
			trackerCount: 0,
			viewerTracking: expect.objectContaining({
				status: 'completed',
				statusWatchlistId: privateList.id,
			}),
		}),
	)
})

test('for-you favors preferred genres and excludes already tracked titles', async () => {
	const [viewer, communityOne, communityTwo] = await Promise.all([
		createUser('viewer'),
		createUser('community_one'),
		createUser('community_two'),
	])
	const [tracked, match, popularMismatch] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Tracked Seed', genres: 'Action, Fantasy' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Affinity Match', genres: 'Fantasy' },
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Popular Mismatch', genres: 'Romance' },
		}),
	])
	await prisma.trackingState.createMany({
		data: [
			{
				ownerId: viewer.id,
				mediaId: tracked.id,
				status: 'completed',
				score: 10,
			},
			{
				ownerId: communityOne.id,
				mediaId: popularMismatch.id,
				status: 'completed',
			},
			{
				ownerId: communityTwo.id,
				mediaId: popularMismatch.id,
				status: 'completed',
			},
		],
	})

	const result = await getDiscoveryResults(
		filters({ sort: 'for-you' }),
		viewer.id,
	)

	expect(result.items.map(item => item.title)).toEqual([
		'Affinity Match',
		'Popular Mismatch',
	])
	expect(result.items.map(item => item.id)).toEqual([
		match.id,
		popularMismatch.id,
	])
	expect(result.preferredGenres).toEqual(['Action', 'Fantasy'])
	expect(result.items.some(item => item.id === tracked.id)).toBe(false)
})

test('favorites teach for-you preferences and stay out of its results', async () => {
	const viewer = await createUser('favorite_viewer')
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
	})
	const [favoriteSeed, affinityMatch, mismatch] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Favorite Mystery Seed',
				genres: 'Mystery, Thriller',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Unseen Mystery Match',
				genres: 'Mystery',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Unseen Comedy Mismatch',
				genres: 'Comedy',
			},
		}),
	])
	await prisma.userFavorite.create({
		data: {
			ownerId: viewer.id,
			mediaId: favoriteSeed.id,
			typeId: listType.id,
			position: 1,
			title: favoriteSeed.title ?? 'Favorite Mystery Seed',
		},
	})

	const result = await getDiscoveryResults(
		filters({ kind: 'anime', sort: 'for-you' }),
		viewer.id,
	)
	expect(result.preferredGenres).toEqual(['Mystery', 'Thriller'])
	expect(result.items.map(item => item.id)).toEqual([
		affinityMatch.id,
		mismatch.id,
	])
	expect(result.items.some(item => item.id === favoriteSeed.id)).toBe(false)
})
