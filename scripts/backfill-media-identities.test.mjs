import { describe, expect, test } from 'vitest'
import {
	linkMediaIdentityBackfillGroup,
	mediaIdentityBackfillPageSize,
	parseMediaIdentityBackfillArguments,
} from './backfill-media-identities.ts'
import { prisma } from '#app/utils/db.server.ts'

describe('media identity backfill budgets', () => {
	test('defaults to an unbounded dry run', () => {
		expect(parseMediaIdentityBackfillArguments([])).toEqual({
			commit: false,
			limit: Infinity,
			scanLimit: Infinity,
		})
	})

	test('makes a finite selection limit the default scan ceiling', () => {
		expect(
			parseMediaIdentityBackfillArguments(['--commit', '--limit', '25']),
		).toEqual({
			commit: true,
			limit: 25,
			scanLimit: 25,
		})
		expect(
			parseMediaIdentityBackfillArguments([
				'--limit',
				'25',
				'--scan-limit',
				'500',
			]),
		).toEqual({
			commit: false,
			limit: 25,
			scanLimit: 500,
		})
	})

	test('rejects ambiguous or partially parsed arguments', () => {
		for (const args of [
			['--unknown'],
			['--limit'],
			['--limit', '0'],
			['--limit', '2x'],
			['--limit', '2', '--limit', '3'],
			['--scan-limit', '2', '--scan-limit', '3'],
			['--commit', '--commit'],
		]) {
			expect(() => parseMediaIdentityBackfillArguments(args)).toThrow()
		}
	})

	test('stops when either the selection or scan budget is exhausted', () => {
		expect(
			mediaIdentityBackfillPageSize({
				selected: 0,
				scanned: 25,
				limit: 25,
				scanLimit: 25,
			}),
		).toBe(0)
		expect(
			mediaIdentityBackfillPageSize({
				selected: 20,
				scanned: 100,
				limit: 25,
				scanLimit: 500,
			}),
		).toBe(5)
		expect(
			mediaIdentityBackfillPageSize({
				selected: 20,
				scanned: 498,
				limit: 25,
				scanLimit: 500,
			}),
		).toBe(2)
	})
})

async function createLegacyEntry(thumbnail) {
	const owner = await prisma.user.create({
		data: {
			email: 'identity-backfill@example.com',
			username: 'identity_backfill',
		},
	})
	const [animeType, mangaType] = await Promise.all([
		prisma.listType.create({
			data: {
				name: 'anime',
				header: 'Anime',
				columns: '{}',
				mediaType: '["episode"]',
				completionType: '{}',
			},
		}),
		prisma.listType.create({
			data: {
				name: 'manga',
				header: 'Manga',
				columns: '{}',
				mediaType: '["chapter"]',
				completionType: '{}',
			},
		}),
	])
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			ownerId: owner.id,
			typeId: animeType.id,
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			position: 1,
			title: 'Legacy identity',
			thumbnail,
		},
	})
	return { owner, animeType, mangaType, watchlist, entry }
}

function legacyEntryCandidate({ animeType, watchlist, entry }, thumbnail) {
	return {
		type: 'entry',
		id: entry.id,
		identity: { provider: 'mal', kind: 'anime', externalId: '5114' },
		thumbnail,
		listTypeId: animeType.id,
		listTypeName: animeType.name,
		watchlistId: watchlist.id,
	}
}

test('links a legacy identity only while its selected inputs still match', async () => {
	const selectedThumbnail =
		'https://image.example/old.jpg|https://myanimelist.net/anime/5114'
	const fixture = await createLegacyEntry(selectedThumbnail)
	const candidate = legacyEntryCandidate(fixture, selectedThumbnail)

	await expect(
		prisma.$transaction(tx => linkMediaIdentityBackfillGroup(tx, [candidate])),
	).resolves.toEqual({ linkedEntries: 1, linkedFavorites: 0 })
	const linked = await prisma.entry.findUniqueOrThrow({
		where: { id: fixture.entry.id },
		select: { mediaId: true },
	})
	expect(linked.mediaId).toEqual(expect.any(String))
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: {
				provider_kind_externalId: candidate.identity,
			},
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: linked.mediaId })
})

test('does not link an identity after its selected thumbnail changes', async () => {
	const selectedThumbnail =
		'https://image.example/old.jpg|https://myanimelist.net/anime/5114'
	const fixture = await createLegacyEntry(selectedThumbnail)
	const candidate = legacyEntryCandidate(fixture, selectedThumbnail)
	await prisma.entry.update({
		where: { id: fixture.entry.id },
		data: {
			thumbnail:
				'https://image.example/new.jpg|https://myanimelist.net/anime/9253',
		},
	})

	await expect(
		prisma.$transaction(tx => linkMediaIdentityBackfillGroup(tx, [candidate])),
	).rejects.toThrow('candidate changed after selection')
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: fixture.entry.id },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: null })
	expect(await prisma.mediaExternalId.count()).toBe(0)
	expect(await prisma.media.count()).toBe(0)
})

test('does not link an identity after its selected list type changes', async () => {
	const selectedThumbnail =
		'https://image.example/old.jpg|https://myanimelist.net/anime/5114'
	const fixture = await createLegacyEntry(selectedThumbnail)
	const candidate = legacyEntryCandidate(fixture, selectedThumbnail)
	await prisma.watchlist.update({
		where: { id: fixture.watchlist.id },
		data: { typeId: fixture.mangaType.id },
	})

	await expect(
		prisma.$transaction(tx => linkMediaIdentityBackfillGroup(tx, [candidate])),
	).rejects.toThrow('candidate changed after selection')
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: fixture.entry.id },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: null })
	expect(await prisma.mediaExternalId.count()).toBe(0)
	expect(await prisma.media.count()).toBe(0)
})

test('rolls back a favorite identity after its selected thumbnail changes', async () => {
	const selectedThumbnail =
		'https://image.example/old.jpg|https://myanimelist.net/anime/5114'
	const fixture = await createLegacyEntry(selectedThumbnail)
	const favorite = await prisma.userFavorite.create({
		data: {
			ownerId: fixture.owner.id,
			typeId: fixture.animeType.id,
			position: 1,
			title: 'Legacy favorite',
			thumbnail: selectedThumbnail,
		},
	})
	const candidate = {
		type: 'favorite',
		id: favorite.id,
		identity: { provider: 'mal', kind: 'anime', externalId: '5114' },
		thumbnail: selectedThumbnail,
		listTypeId: fixture.animeType.id,
		listTypeName: fixture.animeType.name,
	}
	await prisma.userFavorite.update({
		where: { id: favorite.id },
		data: {
			thumbnail:
				'https://image.example/new.jpg|https://myanimelist.net/anime/9253',
		},
	})

	await expect(
		prisma.$transaction(tx => linkMediaIdentityBackfillGroup(tx, [candidate])),
	).rejects.toThrow('candidate changed after selection')
	expect(
		await prisma.userFavorite.findUniqueOrThrow({
			where: { id: favorite.id },
			select: { mediaId: true },
		}),
	).toEqual({ mediaId: null })
	expect(await prisma.mediaExternalId.count()).toBe(0)
	expect(await prisma.media.count()).toBe(0)
})
