import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { hydrateMediaCatalog } from './media.server.ts'

test('catalog hydration atomically creates, reschedules, and clears a release occurrence', async () => {
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: `Occurrence ${faker.string.alphanumeric(8)}`,
		},
	})
	const observedAt = new Date('2026-07-25T12:00:00.000Z')
	const firstRelease = '2026-07-27T18:00:00.000Z'

	await prisma.$transaction(transaction =>
		hydrateMediaCatalog(
			transaction,
			media.id,
			{
				nextRelease: JSON.stringify({
					source: 'anilist',
					observedAt: observedAt.toISOString(),
					releaseDate: firstRelease,
					episode: 4,
				}),
			},
			{ overwrite: true, authoritativeFields: ['nextRelease'] },
		),
	)
	expect(
		await prisma.releaseOccurrence.findFirstOrThrow({
			where: { mediaId: media.id },
		}),
	).toMatchObject({
		source: 'anilist',
		sourceKey: 'next',
		eventType: 'episode',
		releaseAt: new Date(firstRelease),
		episode: 4,
		observedAt,
	})

	const secondRelease = '2026-08-03T18:00:00.000Z'
	await prisma.$transaction(transaction =>
		hydrateMediaCatalog(
			transaction,
			media.id,
			{
				nextRelease: JSON.stringify({
					source: 'anilist',
					observedAt: observedAt.toISOString(),
					releaseDate: secondRelease,
					episode: 5,
				}),
			},
			{ overwrite: true, authoritativeFields: ['nextRelease'] },
		),
	)
	expect(
		await prisma.releaseOccurrence.findMany({
			where: { mediaId: media.id },
		}),
	).toEqual([
		expect.objectContaining({
			releaseAt: new Date(secondRelease),
			episode: 5,
		}),
	])

	await prisma.$transaction(transaction =>
		hydrateMediaCatalog(
			transaction,
			media.id,
			{ nextRelease: null },
			{ overwrite: true, authoritativeFields: ['nextRelease'] },
		),
	)
	expect(
		await prisma.releaseOccurrence.count({ where: { mediaId: media.id } }),
	).toBe(0)
})
