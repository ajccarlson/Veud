import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { hydrateMediaCatalog } from './media.server.ts'
import {
	deriveNextReleaseAt,
	deriveNextReleaseOccurrence,
	parseStoredNextRelease,
} from './release-occurrences.server.ts'

test.each([
	['null input', null],
	['malformed JSON', '{'],
	['JSON null', 'null'],
	['array JSON', '[]'],
	['invalid release date', '{"releaseDate":"not-a-date"}'],
	[
		'missing observedAt',
		'{"releaseDate":"2026-08-03T18:00:00.000Z","source":"anilist"}',
	],
	[
		'missing source',
		'{"releaseDate":"2026-08-03T18:00:00.000Z","observedAt":"2026-07-25T12:00:00.000Z"}',
	],
	[
		'unsupported source',
		'{"releaseDate":"2026-08-03T18:00:00.000Z","source":"other","observedAt":"2026-07-25T12:00:00.000Z"}',
	],
	[
		'invalid observedAt',
		'{"releaseDate":"2026-08-03T18:00:00.000Z","source":"tmdb","observedAt":"never"}',
	],
	['overflow date-only', '{"releaseDate":"2026-02-30"}'],
	['overflow timestamp', '{"releaseDate":"2026-02-30T12:00:00.000Z"}'],
	['ambiguous numeric string', '{"releaseDate":"0"}'],
	['noncanonical timestamp', '{"releaseDate":"2026-08-03T18:00:00Z"}'],
	[
		'overflow observedAt',
		'{"releaseDate":"2026-08-03","source":"tmdb","observedAt":"2026-02-30T12:00:00.000Z"}',
	],
	['numeric year overflow', '{"releaseDate":253402300800000}'],
	['numeric BCE overflow', '{"releaseDate":-62135596800001}'],
])('invalid next-release payload (%s) has no query mirror', (_label, value) => {
	expect(parseStoredNextRelease(value)).toBeNull()
	expect(deriveNextReleaseAt(value)).toBeNull()
})

test('metadata outside Prisma integer bounds is discarded without losing a valid schedule', () => {
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-08-03T18:00:00.000Z',
				episode: 2_147_483_648,
				season: '2',
				chapter: 14.5,
				volume: 3,
			}),
		),
	).toMatchObject({
		episode: null,
		season: null,
		chapter: null,
		volume: 3,
	})
})

test('provider occurrence derivation refuses an observation whose expiry leaves the supported year range', () => {
	const payload = JSON.stringify({
		releaseDate: '9999-12-31T00:00:00.000Z',
		source: 'tmdb',
		observedAt: '9999-12-31T00:00:00.000Z',
	})
	expect(deriveNextReleaseAt(payload)).toEqual(
		new Date('9999-12-31T00:00:00.000Z'),
	)
	expect(deriveNextReleaseOccurrence(payload)).toBeNull()
})

test('legacy source-free and provider-observed payloads share one parser', () => {
	expect(deriveNextReleaseAt('{"releaseDate":"2026-08-03"}')).toEqual(
		new Date('2026-08-03T00:00:00.000Z'),
	)
	expect(
		parseStoredNextRelease(
			'{"releaseDate":"2026-08-03T18:00:00.000Z","source":"tmdb","observedAt":"2026-07-25T12:00:00.000Z"}',
		),
	).toMatchObject({
		releaseAt: new Date('2026-08-03T18:00:00.000Z'),
		source: 'tmdb',
		observedAt: new Date('2026-07-25T12:00:00.000Z'),
	})
	expect(deriveNextReleaseAt('{"releaseDate":1785780000000}')).toEqual(
		new Date(1_785_780_000_000),
	)
})

test('catalog hydration atomically mirrors, reschedules, changes source, and clears a release', async () => {
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
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { nextReleaseAt: true },
		}),
	).toEqual({ nextReleaseAt: new Date(firstRelease) })

	const secondRelease = '2026-08-03T18:00:00.000Z'
	await prisma.$transaction(transaction =>
		hydrateMediaCatalog(
			transaction,
			media.id,
			{
				nextRelease: JSON.stringify({
					source: 'tmdb',
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
			source: 'tmdb',
			releaseAt: new Date(secondRelease),
			episode: 5,
		}),
	])
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { nextReleaseAt: true },
		}),
	).toEqual({ nextReleaseAt: new Date(secondRelease) })

	await prisma.$transaction(transaction =>
		hydrateMediaCatalog(
			transaction,
			media.id,
			{
				nextRelease: JSON.stringify({
					source: 'tmdb',
					releaseDate: secondRelease,
				}),
			},
			{ overwrite: true, authoritativeFields: ['nextRelease'] },
		),
	)
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { nextRelease: true, nextReleaseAt: true },
		}),
	).toEqual({
		nextRelease: JSON.stringify({
			source: 'tmdb',
			releaseDate: secondRelease,
		}),
		nextReleaseAt: null,
	})
	expect(
		await prisma.releaseOccurrence.count({ where: { mediaId: media.id } }),
	).toBe(0)

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
	expect(
		await prisma.media.findUniqueOrThrow({
			where: { id: media.id },
			select: { nextRelease: true, nextReleaseAt: true },
		}),
	).toEqual({ nextRelease: null, nextReleaseAt: null })
})
