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
