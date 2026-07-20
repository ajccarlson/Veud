import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	getMediaRelations,
	syncMediaRelations,
} from './media-relations.server.ts'

test('syncs provider identities and returns inverse relation groups', async () => {
	const source = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'First season',
			externalIds: {
				create: { provider: 'mal', kind: 'anime', externalId: '100' },
			},
		},
	})

	await prisma.$transaction(tx =>
		syncMediaRelations(tx, {
			sourceMediaId: source.id,
			sourceIdentity: {
				provider: 'mal',
				kind: 'anime',
				externalId: '100',
			},
			relations: [
				{
					relationType: 'sequel',
					targetIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '101',
					},
					targetCatalog: {
						title: 'Second season',
						startSeason: 'Fall 2027',
						thumbnail:
							'https://example.com/second.jpg|https://myanimelist.net/anime/101',
					},
				},
			],
		}),
	)

	const target = await prisma.media.findFirstOrThrow({
		where: { externalIds: { some: { externalId: '101' } } },
	})
	expect(await getMediaRelations(source.id)).toEqual([
		{
			relationType: 'sequel',
			label: 'Sequel',
			items: [
				expect.objectContaining({
					id: target.id,
					title: 'Second season',
					year: '2027',
					imageUrl: 'https://example.com/second.jpg',
				}),
			],
		},
	])
	expect(await getMediaRelations(target.id)).toEqual([
		{
			relationType: 'prequel',
			label: 'Prequel',
			items: [
				expect.objectContaining({ id: source.id, title: 'First season' }),
			],
		},
	])
})

test('orders relation groups chronologically and returns tracking context', async () => {
	const viewer = await prisma.user.create({
		data: {
			email: 'relation-viewer@example.com',
			username: 'relation_viewer',
		},
	})
	const [source, later, earlier, undated] = await Promise.all([
		prisma.media.create({ data: { kind: 'movie', title: 'Current film' } }),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Later film',
				releaseStart: new Date('2021-05-01T00:00:00.000Z'),
			},
		}),
		prisma.media.create({
			data: { kind: 'movie', title: 'Earlier film', startSeason: 'Fall 2018' },
		}),
		prisma.media.create({ data: { kind: 'movie', title: 'Undated film' } }),
	])
	await prisma.mediaRelation.createMany({
		data: [later, earlier, undated].map(media => ({
			sourceMediaId: source.id,
			targetMediaId: media.id,
			relationType: 'franchise',
			provider: 'tmdb',
		})),
	})
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: earlier.id,
			status: 'plan-to-watch',
			score: 8.5,
		},
	})

	const [group] = await getMediaRelations(source.id, viewer.id)
	expect(group?.items.map(item => item.title)).toEqual([
		'Earlier film',
		'Later film',
		'Undated film',
	])
	expect(group?.items[0]).toMatchObject({
		trackerCount: 1,
		viewerTracking: {
			status: 'plan-to-watch',
			statusLabel: 'Plan To Watch',
			score: 8.5,
		},
	})
	expect(group?.items[1]).toMatchObject({
		trackerCount: 0,
		viewerTracking: null,
	})
})

test('replaces stale relations from the same provider snapshot', async () => {
	const source = await prisma.media.create({ data: { kind: 'manga' } })
	const sourceIdentity = {
		provider: 'mal' as const,
		kind: 'manga' as const,
		externalId: '200',
	}
	await prisma.mediaExternalId.create({
		data: { ...sourceIdentity, mediaId: source.id },
	})
	await prisma.$transaction(tx =>
		syncMediaRelations(tx, {
			sourceMediaId: source.id,
			sourceIdentity,
			relations: [
				{
					relationType: 'adaptation',
					targetIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '201',
					},
				},
			],
		}),
	)
	expect(await prisma.mediaRelation.count()).toBe(1)

	await prisma.$transaction(tx =>
		syncMediaRelations(tx, {
			sourceMediaId: source.id,
			sourceIdentity,
			relations: [],
		}),
	)
	expect(await prisma.mediaRelation.count()).toBe(0)
})

test('TMDB franchise refreshes preserve other future relation types', async () => {
	const [source, remake] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Original film',
				externalIds: {
					create: { provider: 'tmdb', kind: 'movie', externalId: '300' },
				},
			},
		}),
		prisma.media.create({ data: { kind: 'movie', title: 'Future remake' } }),
	])
	await prisma.mediaRelation.create({
		data: {
			sourceMediaId: source.id,
			targetMediaId: remake.id,
			relationType: 'remake',
			provider: 'tmdb',
		},
	})
	const sourceIdentity = {
		provider: 'tmdb' as const,
		kind: 'movie' as const,
		externalId: '300',
	}

	await prisma.$transaction(tx =>
		syncMediaRelations(tx, {
			sourceMediaId: source.id,
			sourceIdentity,
			relations: [
				{
					relationType: 'franchise',
					targetIdentity: {
						provider: 'tmdb',
						kind: 'movie',
						externalId: '301',
					},
					targetCatalog: { title: 'Franchise sequel' },
				},
			],
		}),
	)
	expect(
		(await getMediaRelations(source.id)).map(group => group.label),
	).toEqual(['Remake', 'Same franchise'])

	await prisma.$transaction(tx =>
		syncMediaRelations(tx, {
			sourceMediaId: source.id,
			sourceIdentity,
			relations: [],
		}),
	)
	expect(await prisma.mediaRelation.findMany()).toEqual([
		expect.objectContaining({
			targetMediaId: remake.id,
			relationType: 'remake',
		}),
	])
})
