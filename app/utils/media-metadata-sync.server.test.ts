import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { entryCatalogMetadataFields } from './media-catalog.ts'
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

	// Partial snapshots also come from member-driven entry/favorite flows. They may
	// fill an empty canonical field, but must not rewrite other members' legacy
	// rows unless the trusted provider caller explicitly opts into propagation.
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
	).toEqual({ description: 'Old description' })

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
