import { faker } from '@faker-js/faker'
import { expect, test, vi } from 'vitest'
import { getCacheOperationsSnapshot } from './cache.server.ts'
import { prisma } from './db.server.ts'
import {
	getDiscoveryGenres,
	getDiscoveryResults,
	getDiscoveryResultsForMediaIds,
	getDiscoveryResultsForPlan,
	getDiscoveryStatuses,
	parseDiscoveryQuery,
} from './discovery.server.ts'
import { type NaturalLanguageDiscoveryPlan } from './natural-language-discovery.ts'

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
		mode: 'standard' as const,
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
			mode: 'unsupported',
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
		mode: 'standard',
		genre: 'Drama',
		year: null,
		status: '',
		provider: 'all',
		sort: 'popular',
		page: 1,
	})
})

test('cached plans still hydrate catalog and viewer state freshly', async () => {
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('VEUD_E2E', '0')
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const query = `Fresh hydration ${suffix}`

	try {
		const [staleCatalogItem, trackedItem, ...fillers] = await Promise.all([
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `${query} 000 stale`,
					genres: 'Drama',
					catalogPopularity: 20,
				},
			}),
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `${query} 001 tracked`,
					genres: 'Drama',
					catalogPopularity: 10,
				},
			}),
			...Array.from({ length: 23 }, (_, index) =>
				prisma.media.create({
					data: {
						kind: 'movie',
						title: `${query} ${String(index + 2).padStart(3, '0')} filler`,
						genres: 'Drama',
					},
				}),
			),
		])
		const publicFilters = filters({
			q: query,
			kind: 'movie',
			sort: 'popular',
		})
		const initial = await getDiscoveryResults(publicFilters, null)
		expect(initial.items.map(item => item.id)).toEqual(
			expect.arrayContaining([staleCatalogItem.id, trackedItem.id]),
		)
		expect(initial.items).toHaveLength(24)
		expect(initial.total).toBe(25)

		const viewer = await createUser('fresh_hydration')
		await Promise.all([
			prisma.media.update({
				where: { id: staleCatalogItem.id },
				data: { title: `Removed from ${suffix}` },
			}),
			prisma.trackingState.create({
				data: {
					ownerId: viewer.id,
					mediaId: trackedItem.id,
					status: 'watching',
				},
			}),
		])

		const hydrated = await getDiscoveryResults(publicFilters, viewer.id)
		expect(hydrated.items.map(item => item.id)).toEqual(
			expect.arrayContaining([trackedItem.id, ...fillers.map(item => item.id)]),
		)
		expect(hydrated.items).toHaveLength(24)
		expect(hydrated.total).toBe(24)
		expect(hydrated.pageCount).toBe(1)
		expect(hydrated.items[0]?.viewerTracking).toEqual({
			status: 'watching',
			statusWatchlistId: null,
		})
		expect(getCacheOperationsSnapshot()['ranked-discovery']).toMatchObject({
			hit: 1,
			miss: 1,
			refresh: 1,
		})

		const personalizedQuery = `Viewer exclusion ${suffix}`
		const exclusionTarget = await prisma.media.create({
			data: {
				kind: 'movie',
				title: `${personalizedQuery} target`,
				genres: 'Drama',
				catalogPopularity: 5,
			},
		})
		const personalizedFilters = filters({
			q: personalizedQuery,
			kind: 'movie',
			sort: 'for-you',
		})
		const beforeExclusion = await getDiscoveryResults(
			personalizedFilters,
			viewer.id,
		)
		expect(beforeExclusion.items.map(item => item.id)).toContain(
			exclusionTarget.id,
		)
		expect(beforeExclusion.total).toBe(1)

		await prisma.recommendationFeedback.create({
			data: {
				ownerId: viewer.id,
				mediaId: exclusionTarget.id,
				feedbackType: 'not_interested',
			},
		})
		const afterExclusion = await getDiscoveryResults(
			personalizedFilters,
			viewer.id,
		)
		expect(afterExclusion.items.map(item => item.id)).not.toContain(
			exclusionTarget.id,
		)
		expect(afterExclusion.total).toBe(0)
		expect(afterExclusion.pageCount).toBe(1)
	} finally {
		vi.unstubAllEnvs()
	}
})

test('grounded media IDs preserve candidate order and ignore stale search filters', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const movies = await Promise.all(
		Array.from({ length: 6 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Ordered memory ${suffix} ${index + 1}`,
					genres: 'Mystery',
					releaseStatus: 'Released',
					releaseStart: new Date(`202${index}-01-01T00:00:00.000Z`),
				},
			}),
		),
	)
	const wrongKind = await prisma.media.create({
		data: {
			kind: 'anime',
			title: `Wrong kind memory ${suffix}`,
		},
	})
	const requestedIds = [
		movies[2]!.id,
		movies[0]!.id,
		movies[2]!.id,
		movies[4]!.id,
		movies[1]!.id,
		movies[3]!.id,
		movies[5]!.id,
	]

	try {
		const result = await getDiscoveryResultsForMediaIds(
			filters({
				q: 'literal text that does not occur in any title',
				kind: 'movie',
				mode: 'memory',
				genre: 'Comedy',
				year: 1999,
				status: 'Upcoming',
				provider: 'mal',
				sort: 'top-rated',
				page: 8,
			}),
			null,
			requestedIds,
		)
		expect(result.items.map(item => item.id)).toEqual([
			movies[2]!.id,
			movies[0]!.id,
			movies[4]!.id,
			movies[1]!.id,
			movies[3]!.id,
		])

		const typeSafeResult = await getDiscoveryResultsForMediaIds(
			filters({ kind: 'movie', mode: 'memory' }),
			null,
			[wrongKind.id, movies[0]!.id],
		)
		expect(typeSafeResult.items.map(item => item.id)).toEqual([movies[0]!.id])
	} finally {
		await prisma.media.deleteMany({
			where: { id: { in: [...movies.map(item => item.id), wrongKind.id] } },
		})
	}
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

test('genre filters match mixed-case delimited tokens without substrings', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const storedGenre = `MiXeDgEnRe${suffix}`
	const [singleton, first, middle, last, prefixed, suffixed] =
		await Promise.all(
			[
				['Genre Exact', storedGenre],
				['Genre First', `${storedGenre}, Drama`],
				['Genre Middle', `Drama, ${storedGenre}, Mystery`],
				['Genre Last', `Drama, ${storedGenre}`],
				['Genre Prefixed', `Super${storedGenre}`],
				['Genre Suffixed', `${storedGenre}Extended`],
			].map(([title, genres]) =>
				prisma.media.create({
					data: {
						kind: 'movie',
						title: `${title} ${suffix}`,
						genres,
					},
				}),
			),
		)

	const result = await getDiscoveryResults(
		filters({
			kind: 'movie',
			genre: `mIxEdGeNrE${suffix.toUpperCase()}`,
			sort: 'title',
		}),
		null,
	)
	expect(result.total).toBe(4)
	expect(new Set(result.items.map(item => item.id))).toEqual(
		new Set([singleton.id, first.id, middle.id, last.id]),
	)
	expect(result.items.map(item => item.id)).not.toEqual(
		expect.arrayContaining([prefixed.id, suffixed.id]),
	)
})

test('discovery matches mixed-case canonical and alternate titles', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: `The MiXeD CaSe Signal ${suffix}`,
			titles: {
				create: {
					provider: 'tmdb',
					language: 'en',
					titleType: 'alternate',
					value: `Hidden Alias ${suffix}`,
					normalized: `hidden alias ${suffix}`,
				},
			},
		},
	})

	const canonical = await getDiscoveryResults(
		filters({
			q: `mIxEd CaSe SiGnAl ${suffix.toUpperCase()}`,
			kind: 'movie',
			sort: 'title',
		}),
		null,
	)
	const alternate = await getDiscoveryResults(
		filters({
			q: `HiDdEn AlIaS ${suffix.toUpperCase()}`,
			kind: 'movie',
			sort: 'title',
		}),
		null,
	)

	expect(canonical.items.map(item => item.id)).toEqual([media.id])
	expect(alternate.items).toEqual([
		expect.objectContaining({
			id: media.id,
			matchedTitle: `Hidden Alias ${suffix}`,
		}),
	])
})

test('anime and manga popularity use MAL rank without score or community reshuffling', async () => {
	for (const kind of ['anime', 'manga'] as const) {
		const communityMember = await createUser(`${kind}_rank_member`)
		const [rankOne, rankTwo, unranked] = await Promise.all([
			prisma.media.create({
				data: {
					kind,
					title: `${kind} Z Rank One`,
					catalogPopularity: 0.001,
				},
			}),
			prisma.media.create({
				data: {
					kind,
					title: `${kind} M Rank Two`,
					catalogPopularity: 999,
				},
			}),
			prisma.media.create({
				data: {
					kind,
					title: `${kind} A Unranked`,
					catalogPopularity: 10_000,
				},
			}),
		])
		await prisma.catalogFeedItem.createMany({
			data: [
				{
					provider: 'mal',
					kind,
					feed: 'popular',
					rank: 1,
					rankingScore: 0,
					observedAt: new Date('2026-07-24T00:00:00Z'),
					mediaId: rankOne.id,
				},
				{
					provider: 'mal',
					kind,
					feed: 'popular',
					rank: 2,
					rankingScore: 1,
					observedAt: new Date('2026-07-24T00:00:00Z'),
					mediaId: rankTwo.id,
				},
			],
		})
		await prisma.trackingState.create({
			data: {
				ownerId: communityMember.id,
				mediaId: rankTwo.id,
				status: 'completed',
				score: 10,
			},
		})

		const result = await getDiscoveryResults(
			filters({ kind, sort: 'popular' }),
			null,
		)
		expect(result.items.map(item => item.id)).toEqual([
			rankOne.id,
			rankTwo.id,
			unranked.id,
		])
		expect(result.items[1]).toEqual(
			expect.objectContaining({
				id: rankTwo.id,
				communityScore: 10,
				ratingCount: 1,
				trackerCount: 1,
			}),
		)

		const duplicateKindPlan: NaturalLanguageDiscoveryPlan = {
			kinds: [kind, kind],
			includeGenres: [],
			excludeGenres: [],
			includeTerms: [],
			excludeTerms: [],
			yearFrom: null,
			yearTo: null,
			releaseStatus: null,
			language: null,
			toneTerms: [],
			pace: null,
			lengthUnit: null,
			lengthFrom: null,
			lengthTo: null,
			sort: 'popular',
			explanation: `Popular ${kind} with a duplicated kind constraint.`,
			unsupportedConstraints: [],
		}
		const naturalResult = await getDiscoveryResultsForPlan(
			duplicateKindPlan,
			null,
			{
				page: 1,
				filters: filters({ mode: 'describe', kind }),
			},
		)
		expect(naturalResult.items.map(item => item.id)).toEqual([
			rankOne.id,
			rankTwo.id,
			unranked.id,
		])
	}
})

test('TMDB popularity applies only the bounded public community boost', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [publicMember, privateMember] = await Promise.all([
		createUser('tmdb_public_boost'),
		createUser('tmdb_private_boost'),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `tmdb-boost-${suffix}`,
			header: 'TMDB boost',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{}',
		},
	})
	const privateList = await prisma.watchlist.create({
		data: {
			ownerId: privateMember.id,
			typeId: listType.id,
			name: 'private',
			header: 'Private',
			isPublic: false,
		},
	})
	const [baseline, publicBoost, privateBoost] = await Promise.all(
		['Baseline', 'Public', 'Private'].map(label =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `TMDB ${label} boost ${suffix}`,
				},
			}),
		),
	)
	await Promise.all([
		prisma.catalogFeedItem.createMany({
			data: [
				{
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: 1,
					rankingScore: 1,
					rankingVersion: 999,
					observedAt: new Date(),
					mediaId: baseline.id,
				},
				{
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: 2,
					rankingScore: 0.99999,
					rankingVersion: 999,
					observedAt: new Date(),
					mediaId: publicBoost.id,
				},
				{
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: 3,
					rankingScore: 0.99999,
					rankingVersion: 999,
					observedAt: new Date(),
					mediaId: privateBoost.id,
				},
			],
		}),
		prisma.trackingState.create({
			data: {
				ownerId: publicMember.id,
				mediaId: publicBoost.id,
				status: 'completed',
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: privateMember.id,
				mediaId: privateBoost.id,
				status: 'completed',
				statusWatchlistId: privateList.id,
			},
		}),
	])

	const result = await getDiscoveryResults(
		filters({ kind: 'movie', sort: 'popular' }),
		null,
	)

	expect(result.items.slice(0, 3).map(item => item.id)).toEqual([
		publicBoost.id,
		baseline.id,
		privateBoost.id,
	])
	expect(
		result.items.find(item => item.id === publicBoost.id)?.trackerCount,
	).toBe(1)
	expect(
		result.items.find(item => item.id === privateBoost.id)?.trackerCount,
	).toBe(0)
})

test('natural discovery enforces locally stored episode bounds', async () => {
	await prisma.media.createMany({
		data: [
			{
				kind: 'anime',
				title: 'Compact Twelve Episode Series',
				episodeCount: 12,
			},
			{
				kind: 'anime',
				title: 'Long Twenty Six Episode Series',
				episodeCount: 26,
			},
			{
				kind: 'movie',
				title: 'Unrelated Short Movie',
				runtimeMinutes: 90,
			},
		],
	})
	const plan: NaturalLanguageDiscoveryPlan = {
		kinds: ['anime'],
		includeGenres: [],
		excludeGenres: [],
		includeTerms: [],
		excludeTerms: [],
		yearFrom: null,
		yearTo: null,
		releaseStatus: null,
		language: null,
		toneTerms: [],
		pace: null,
		lengthUnit: 'episodes',
		lengthFrom: null,
		lengthTo: 23,
		sort: 'title',
		explanation: 'Anime series under 24 episodes.',
		unsupportedConstraints: [],
	}

	const result = await getDiscoveryResultsForPlan(plan, null, {
		page: 1,
		filters: filters({ mode: 'describe', kind: 'anime' }),
	})

	expect(result.items.map(item => item.title)).toEqual([
		'Compact Twelve Episode Series',
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

test('top-rated pages use one stable global ranking without duplicates', async () => {
	await Promise.all(
		Array.from({ length: 30 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'tv',
					title: `Stable Rated ${String(index + 1).padStart(2, '0')}`,
					catalogScore: 6 + (index % 5),
					externalIds: {
						create: {
							provider: 'tmdb',
							kind: 'tv',
							externalId: `stable-rated-${index + 1}`,
							sourceAudience: 1_000 + index * 250,
							sourceRatingCount: 100 + index * 25,
						},
					},
				},
			}),
		),
	)

	const first = await getDiscoveryResults(
		filters({ kind: 'tv', sort: 'top-rated', page: 1 }),
		null,
	)
	const second = await getDiscoveryResults(
		filters({ kind: 'tv', sort: 'top-rated', page: 2 }),
		null,
	)
	const repeatedFirst = await getDiscoveryResults(
		filters({ kind: 'tv', sort: 'top-rated', page: 1 }),
		null,
	)

	expect(first.items).toHaveLength(24)
	expect(second.items).toHaveLength(6)
	expect(
		new Set([...first.items, ...second.items].map(item => item.id)).size,
	).toBe(30)
	expect(repeatedFirst.items.map(item => item.id)).toEqual(
		first.items.map(item => item.id),
	)
})

test('private-list tracking stays personal and does not affect discovery aggregates', async () => {
	const [publicMember, privateMember, listlessRater, listlessTracker] =
		await Promise.all([
			createUser('public_discovery_member'),
			createUser('private_discovery_member'),
			createUser('listless_discovery_rater'),
			createUser('listless_discovery_tracker'),
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
		prisma.trackingState.create({
			data: {
				ownerId: listlessRater.id,
				mediaId: publicTitle.id,
				status: 'completed',
				score: 6,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: listlessTracker.id,
				mediaId: publicTitle.id,
				status: 'watching',
			},
		}),
	])

	const topRated = await getDiscoveryResults(
		filters({ q: 'Discovery Privacy', sort: 'top-rated' }),
		null,
	)
	expect(topRated.items.map(item => item.id)).toEqual([publicTitle.id])
	expect(topRated.items[0]).toEqual(
		expect.objectContaining({
			communityScore: 7,
			ratingCount: 2,
			trackerCount: 3,
		}),
	)

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

test('natural for-you ranks globally and applies every fresh viewer exclusion', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const viewer = await createUser('natural_for_you_viewer')
	const listType = await prisma.listType.create({
		data: {
			name: `natural-for-you-${suffix}`,
			header: 'Natural for you',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{}',
		},
	})
	await prisma.media.createMany({
		data: Array.from({ length: 24 }, (_, index) => ({
			kind: 'movie',
			title: `Natural filler ${suffix} ${String(index + 1).padStart(2, '0')}`,
			genres: 'Comedy',
			catalogPopularity: 10_000 - index,
		})),
	})
	const fillers = await prisma.media.findMany({
		where: { title: { contains: `Natural filler ${suffix}` } },
		orderBy: [{ title: 'asc' }],
		select: { id: true },
	})
	const [trackedSeed, favoriteSeed, feedbackSeed, affinityMatch] =
		await Promise.all([
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Natural tracked seed ${suffix}`,
					genres: 'Mystery',
					catalogPopularity: 20_000,
				},
			}),
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Natural favorite seed ${suffix}`,
					genres: 'Mystery',
					catalogPopularity: 19_000,
				},
			}),
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Natural feedback seed ${suffix}`,
					genres: 'Mystery',
					catalogPopularity: 18_000,
				},
			}),
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Natural global affinity ${suffix}`,
					genres: 'Mystery',
					catalogPopularity: 1,
				},
			}),
		])
	await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: trackedSeed.id,
				status: 'completed',
				score: 10,
			},
		}),
		prisma.userFavorite.create({
			data: {
				ownerId: viewer.id,
				mediaId: favoriteSeed.id,
				typeId: listType.id,
				position: 1,
				title: favoriteSeed.title ?? 'Favorite seed',
			},
		}),
		prisma.recommendationFeedback.create({
			data: {
				ownerId: viewer.id,
				mediaId: feedbackSeed.id,
				feedbackType: 'not-interested',
			},
		}),
		prisma.catalogFeedItem.createMany({
			data: [
				...fillers.map((item, index) => ({
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: index + 1,
					rankingScore: 1 - index / 100,
					rankingVersion: 999,
					observedAt: new Date(),
					mediaId: item.id,
				})),
				...[
					trackedSeed.id,
					favoriteSeed.id,
					feedbackSeed.id,
					affinityMatch.id,
				].map((mediaId, index) => ({
					provider: 'tmdb',
					kind: 'movie',
					feed: 'popular',
					rank: fillers.length + index + 1,
					rankingScore: 0.5 - index / 100,
					rankingVersion: 999,
					observedAt: new Date(),
					mediaId,
				})),
			],
		}),
	])
	const plan: NaturalLanguageDiscoveryPlan = {
		kinds: ['movie'],
		includeGenres: [],
		excludeGenres: [],
		includeTerms: [],
		excludeTerms: [],
		yearFrom: null,
		yearTo: null,
		releaseStatus: null,
		language: null,
		toneTerms: [],
		pace: null,
		lengthUnit: null,
		lengthFrom: null,
		lengthTo: null,
		sort: 'for-you',
		explanation: 'Find an unseen movie for this viewer.',
		unsupportedConstraints: [],
	}

	const result = await getDiscoveryResultsForPlan(plan, viewer.id, {
		page: 1,
		filters: filters({ mode: 'describe', sort: 'for-you' }),
	})

	expect(result.items[0]?.id).toBe(affinityMatch.id)
	expect(result.preferredGenres).toEqual(['Mystery'])
	expect(result.items.map(item => item.id)).not.toEqual(
		expect.arrayContaining([trackedSeed.id, favoriteSeed.id, feedbackSeed.id]),
	)
})

test('top-rated pagination reports only the bounded accessible plan', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const query = `Bounded ranking ${suffix}`
	await prisma.media.createMany({
		data: Array.from({ length: 1_001 }, (_, index) => ({
			kind: 'movie',
			title: `${query} ${String(index + 1).padStart(4, '0')}`,
			catalogScore: 6 + (index % 5),
			catalogPopularity: index,
		})),
	})

	const result = await getDiscoveryResults(
		filters({ q: query, sort: 'top-rated', page: 1_000 }),
		null,
	)

	expect(result.total).toBe(1_000)
	expect(result.pageCount).toBe(42)
	expect(result.filters.page).toBe(42)
	expect(result.items).toHaveLength(16)
})
