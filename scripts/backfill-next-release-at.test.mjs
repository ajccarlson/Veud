import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { repairNextReleaseCandidate } from './backfill-next-release-at.ts'
import { prisma } from '#app/utils/db.server.ts'

test('repairs the current payload and skips a payload changed before its guarded write', async () => {
	const original = JSON.stringify({ releaseDate: '2026-08-03' })
	const replacement = JSON.stringify({ releaseDate: '2026-08-04' })
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: `Backfill race ${faker.string.alphanumeric(8)}`,
			nextRelease: original,
		},
	})

	const conflicted = await prisma.$transaction(transaction =>
		repairNextReleaseCandidate(transaction, media.id, {
			beforeGuardedWrite: async () => {
				await transaction.media.update({
					where: { id: media.id },
					data: { nextRelease: replacement },
				})
			},
		}),
	)
	expect(conflicted).toEqual({
		repairMirror: false,
		repairOccurrence: false,
		conflicted: true,
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { nextRelease: true, nextReleaseAt: true },
		}),
	).toEqual({ nextRelease: replacement, nextReleaseAt: null })
	const beforeRepair = await prisma.media.findUniqueOrThrow({
		where: { id: media.id },
		select: { updatedAt: true },
	})

	const repaired = await prisma.$transaction(transaction =>
		repairNextReleaseCandidate(transaction, media.id),
	)
	expect(repaired).toEqual({
		repairMirror: true,
		repairOccurrence: false,
		conflicted: false,
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { nextRelease: true, nextReleaseAt: true },
		}),
	).toEqual({
		nextRelease: replacement,
		nextReleaseAt: new Date('2026-08-04T00:00:00.000Z'),
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { updatedAt: true },
		}),
	).toEqual(beforeRepair)

	await expect(
		prisma.$transaction(transaction =>
			repairNextReleaseCandidate(transaction, 'deleted-media-id'),
		),
	).resolves.toEqual({
		repairMirror: false,
		repairOccurrence: false,
		conflicted: false,
	})
})

test('repairs provider occurrences, deletes stale rows, and is idempotent', async () => {
	const observedAt = new Date('2026-07-28T12:00:00.000Z')
	const releaseAt = new Date('2026-08-03T18:00:00.123Z')
	const providerPayload = JSON.stringify({
		releaseDate: releaseAt.toISOString(),
		source: 'tmdb',
		observedAt: observedAt.toISOString(),
		season: 2,
		episode: 5,
		name: 'Episode five',
	})
	const providerMedia = await prisma.media.create({
		data: {
			kind: 'tv',
			title: `Provider occurrence ${faker.string.alphanumeric(8)}`,
			nextRelease: providerPayload,
			nextReleaseAt: new Date('2026-08-02T18:00:00.000Z'),
			releaseOccurrences: {
				create: [
					{
						source: 'tmdb',
						sourceKey: 'next',
						eventType: 'release',
						releaseAt: new Date('2026-08-01T18:00:00.000Z'),
						observedAt,
						expiresAt: new Date('2026-08-02T18:00:00.000Z'),
					},
					{
						source: 'anilist',
						sourceKey: 'next',
						eventType: 'episode',
						releaseAt: new Date('2026-08-04T18:00:00.000Z'),
						episode: 6,
						observedAt,
						expiresAt: new Date('2026-08-11T18:00:00.000Z'),
					},
				],
			},
		},
		select: { id: true, updatedAt: true },
	})
	const staleMedia = await prisma.media.create({
		data: {
			kind: 'anime',
			title: `Stale occurrence ${faker.string.alphanumeric(8)}`,
			nextReleaseAt: new Date('2026-08-01T00:00:00.000Z'),
			releaseOccurrences: {
				create: {
					source: 'tmdb',
					sourceKey: 'next',
					eventType: 'episode',
					releaseAt: new Date('2026-08-01T00:00:00.000Z'),
					episode: 1,
					observedAt,
					expiresAt: new Date('2026-08-11T00:00:00.000Z'),
				},
			},
		},
		select: { id: true, updatedAt: true },
	})

	await expect(
		prisma.$transaction(transaction =>
			repairNextReleaseCandidate(transaction, providerMedia.id),
		),
	).resolves.toEqual({
		repairMirror: true,
		repairOccurrence: true,
		conflicted: false,
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: providerMedia.id },
			select: {
				nextReleaseAt: true,
				updatedAt: true,
				releaseOccurrences: {
					select: {
						source: true,
						sourceKey: true,
						eventType: true,
						releaseAt: true,
						allDay: true,
						season: true,
						episode: true,
						name: true,
						status: true,
						observedAt: true,
						expiresAt: true,
					},
				},
			},
		}),
	).toEqual({
		nextReleaseAt: releaseAt,
		updatedAt: providerMedia.updatedAt,
		releaseOccurrences: [
			{
				source: 'tmdb',
				sourceKey: 'next',
				eventType: 'episode',
				releaseAt,
				allDay: false,
				season: 2,
				episode: 5,
				name: 'Episode five',
				status: 'scheduled',
				observedAt,
				expiresAt: new Date('2026-08-11T12:00:00.000Z'),
			},
		],
	})
	await expect(
		prisma.$transaction(transaction =>
			repairNextReleaseCandidate(transaction, providerMedia.id),
		),
	).resolves.toEqual({
		repairMirror: false,
		repairOccurrence: false,
		conflicted: false,
	})

	await expect(
		prisma.$transaction(transaction =>
			repairNextReleaseCandidate(transaction, staleMedia.id),
		),
	).resolves.toEqual({
		repairMirror: true,
		repairOccurrence: true,
		conflicted: false,
	})
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: staleMedia.id },
			select: {
				nextReleaseAt: true,
				updatedAt: true,
				releaseOccurrences: { select: { id: true } },
			},
		}),
	).toEqual({
		nextReleaseAt: null,
		updatedAt: staleMedia.updatedAt,
		releaseOccurrences: [],
	})
	await expect(
		prisma.$transaction(transaction =>
			repairNextReleaseCandidate(transaction, staleMedia.id),
		),
	).resolves.toEqual({
		repairMirror: false,
		repairOccurrence: false,
		conflicted: false,
	})
})
