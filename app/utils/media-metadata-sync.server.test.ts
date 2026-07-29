import { faker } from '@faker-js/faker'
import { type Prisma } from '@prisma/client'
import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	emptyMediaCatalogData,
	entryCatalogMetadataFields,
} from './media-catalog.ts'
import { hydrateMediaCatalog } from './media.server.ts'
import { synchronizeWatchlistMetadata } from './watchlist-metadata-sync.server.ts'

test('catalog updates refresh entry metadata without changing member data', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
	})
	const listType = await prisma.listType.upsert({
		where: { name: `anime-${suffix}` },
		update: {},
		create: {
			name: `anime-${suffix}`,
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			ownerId: owner.id,
			typeId: listType.id,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Old catalog title' },
	})
	const history = JSON.stringify({ progress: { episode: 4 } })
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			mediaId: media.id,
			position: 1,
			title: 'Old catalog title',
			thumbnail: 'old.jpg',
			description: 'Old description',
			length: '4 / 12 eps',
			chapters: '18 / 100',
			volumes: '2 / 10',
			personal: 9.25,
			story: 8,
			notes: 'Keep this note',
			history,
		},
	})

	// The first trusted provider write establishes a clean row-level provenance
	// baseline before applying even a partial provider snapshot.
	await prisma.$transaction(tx =>
		hydrateMediaCatalog(tx, media.id, {
			description: 'Partial client-derived description',
		}),
	)
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: entry.id },
			select: { description: true },
		}),
	).toEqual({ description: null })

	await prisma.$transaction(tx =>
		hydrateMediaCatalog(
			tx,
			media.id,
			{
				title: 'Current catalog title',
				thumbnail: 'current.jpg',
				description: 'Current description',
				length: '24 eps',
				chapters: '120',
				volumes: '12',
				malScore: 8.6,
				releaseStatus: 'Currently Airing',
			},
			{
				overwrite: true,
				syncLegacyFields: entryCatalogMetadataFields,
			},
		),
	)

	const updated = await prisma.entry.findUniqueOrThrow({
		where: { id: entry.id },
	})
	expect(updated).toMatchObject({
		title: 'Current catalog title',
		thumbnail: 'current.jpg',
		description: 'Current description',
		length: '4 / 12 eps',
		chapters: '18 / 100',
		volumes: '2 / 10',
		notes: 'Keep this note',
		history,
		story: 8,
	})
	expect(Number(updated.personal)).toBe(9.25)
	expect(Number(updated.malScore)).toBe(8.6)

	await prisma.media.update({
		where: { id: media.id },
		data: { title: 'Reconciled catalog title', description: 'Reconciled copy' },
	})
	const preview = await synchronizeWatchlistMetadata(prisma, { batchSize: 1 })
	expect(preview).toEqual({
		dryRun: true,
		scanned: 1,
		matched: 1,
		updated: 0,
		favoriteScanned: 0,
		favoriteMatched: 0,
		favoriteUpdated: 0,
	})
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: entry.id },
			select: { title: true },
		}),
	).toEqual({ title: 'Current catalog title' })

	const committed = await synchronizeWatchlistMetadata(prisma, {
		batchSize: 1,
		commit: true,
	})
	expect(committed).toEqual({
		dryRun: false,
		scanned: 1,
		matched: 1,
		updated: 1,
		favoriteScanned: 0,
		favoriteMatched: 0,
		favoriteUpdated: 0,
	})
	expect(
		await prisma.entry.findUniqueOrThrow({
			where: { id: entry.id },
			select: {
				title: true,
				description: true,
				length: true,
				personal: true,
				notes: true,
			},
		}),
	).toMatchObject({
		title: 'Reconciled catalog title',
		description: 'Reconciled copy',
		length: '4 / 12 eps',
		notes: 'Keep this note',
	})
})

test('concurrent baseline hydration retries without erasing promoted fields', async () => {
	const state: Record<string, unknown> = {
		kind: 'anime',
		catalogProvenanceVersion: 0,
		...emptyMediaCatalogData(),
	}
	let markStaleAttempted!: () => void
	const staleAttempted = new Promise<void>(resolve => {
		markStaleAttempted = resolve
	})
	let markPromoted!: () => void
	const promoted = new Promise<void>(resolve => {
		markPromoted = resolve
	})

	function transactionClient(delayBaselineClaim: boolean) {
		const updateMany = vi.fn(
			async (args: {
				where: { catalogProvenanceVersion: number }
				data: Record<string, unknown>
			}) => {
				if (delayBaselineClaim) {
					markStaleAttempted()
					await promoted
				}
				if (
					state.catalogProvenanceVersion !== args.where.catalogProvenanceVersion
				) {
					return { count: 0 }
				}
				Object.assign(state, args.data)
				if (!delayBaselineClaim) markPromoted()
				return { count: 1 }
			},
		)
		const update = vi.fn(async (args: { data: Record<string, unknown> }) => {
			Object.assign(state, args.data)
			return state
		})
		const client = {
			media: {
				findUniqueOrThrow: vi.fn(async () => ({ ...state })),
				updateMany,
				update,
			},
			entry: { updateMany: vi.fn(async () => ({ count: 0 })) },
			userFavorite: { updateMany: vi.fn(async () => ({ count: 0 })) },
			libraryImportItem: { updateMany: vi.fn(async () => ({ count: 0 })) },
			mediaRelation: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			releaseOccurrence: {
				deleteMany: vi.fn(async () => ({ count: 0 })),
				upsert: vi.fn(),
			},
		} as unknown as Prisma.TransactionClient
		return { client, updateMany, update }
	}

	const stale = transactionClient(true)
	const winner = transactionClient(false)
	const staleHydration = hydrateMediaCatalog(stale.client, 'shared-media', {
		description: 'Description from the delayed hydrator',
	})
	await staleAttempted
	const winningHydration = hydrateMediaCatalog(winner.client, 'shared-media', {
		title: 'Title promoted by the winner',
		thumbnail: 'winner.jpg',
	})
	await Promise.all([staleHydration, winningHydration])

	expect(state).toEqual(
		expect.objectContaining({
			catalogProvenanceVersion: 1,
			title: 'Title promoted by the winner',
			thumbnail: 'winner.jpg',
			description: 'Description from the delayed hydrator',
		}),
	)
	expect(stale.updateMany).toHaveBeenCalledTimes(1)
	expect(stale.update).toHaveBeenCalledTimes(1)
	expect(stale.update.mock.calls[0]?.[0].data).not.toHaveProperty('title')
})

test('metadata repair clears linked historical snapshots while preserving member data', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `metadata-repair-${suffix}@example.com`,
			username: `metadata_repair_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `metadata-repair-${suffix}`,
			header: 'Metadata repair',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const media = await prisma.media.create({ data: { kind: 'anime' } })
	const privateSentinel = `PRIVATE_LINKED_SNAPSHOT_${suffix}`
	const [entry, favorite] = await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: watchlist.id,
				mediaId: media.id,
				position: 1,
				title: `${privateSentinel} title`,
				thumbnail: `${privateSentinel} thumbnail`,
				description: `${privateSentinel} description`,
				personal: 9,
				notes: 'Keep member note',
			},
		}),
		prisma.userFavorite.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				mediaId: media.id,
				position: 1,
				title: `${privateSentinel} favorite title`,
				thumbnail: `${privateSentinel} favorite thumbnail`,
				mediaType: `${privateSentinel} favorite type`,
				startYear: `${privateSentinel} favorite year`,
			},
		}),
	])

	await expect(
		synchronizeWatchlistMetadata(prisma, { batchSize: 1 }),
	).resolves.toEqual({
		dryRun: true,
		scanned: 1,
		matched: 1,
		updated: 0,
		favoriteScanned: 1,
		favoriteMatched: 1,
		favoriteUpdated: 0,
	})
	const entryUpdate = vi.spyOn(prisma.entry, 'updateMany')
	const favoriteUpdate = vi.spyOn(prisma.userFavorite, 'updateMany')
	await expect(
		synchronizeWatchlistMetadata(prisma, { batchSize: 1, commit: true }),
	).resolves.toEqual({
		dryRun: false,
		scanned: 1,
		matched: 1,
		updated: 1,
		favoriteScanned: 1,
		favoriteMatched: 1,
		favoriteUpdated: 1,
	})
	expect(entryUpdate).toHaveBeenCalledWith(
		expect.objectContaining({
			where: { id: entry.id, mediaId: media.id },
		}),
	)
	expect(favoriteUpdate).toHaveBeenCalledWith(
		expect.objectContaining({
			where: { id: favorite.id, mediaId: media.id },
		}),
	)

	expect(
		await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } }),
	).toEqual(
		expect.objectContaining({
			title: 'Untitled anime',
			thumbnail: null,
			description: null,
			notes: 'Keep member note',
		}),
	)
	expect(
		Number(
			(
				await prisma.entry.findUniqueOrThrow({
					where: { id: entry.id },
					select: { personal: true },
				})
			).personal,
		),
	).toBe(9)
	expect(
		await prisma.userFavorite.findUniqueOrThrow({
			where: { id: favorite.id },
		}),
	).toEqual(
		expect.objectContaining({
			title: 'Untitled anime',
			thumbnail: null,
			mediaType: null,
			startYear: null,
		}),
	)
	expect(
		JSON.stringify(
			await Promise.all([
				prisma.entry.findUnique({ where: { id: entry.id } }),
				prisma.userFavorite.findUnique({ where: { id: favorite.id } }),
			]),
		),
	).not.toContain(privateSentinel)
})
