import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	applyLibraryImportBatch,
	LibraryImportError,
	rollbackLibraryImportBatch,
} from './library-import-commit.server.ts'
import { type LibraryImportItem } from './library-import.ts'

function suffix() {
	return faker.string.alphanumeric({ length: 10 }).toLowerCase()
}

async function owner() {
	const id = suffix()
	return prisma.user.create({
		data: { username: `import_${id}`, email: `import_${id}@example.com` },
	})
}

async function media(title: string) {
	return prisma.media.create({ data: { kind: 'anime', title } })
}

async function animeListType() {
	return prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns:
				'{"position":"number","thumbnail":"string","title":"string","personal":"number","length":"string"}',
			mediaType: '["episode"]',
			completionType:
				'{"present":"watch","past":"watched","continuous":"watching"}',
		},
	})
}

function payload(
	sourceKey: string,
	title: string,
	overrides: Partial<LibraryImportItem> = {},
) {
	return JSON.stringify({
		sourceKey,
		provider: 'myanimelist',
		mediaKind: 'anime',
		title,
		externalId: null,
		status: 'completed',
		score: 9,
		progress: { episodes: 12 },
		repeatCount: 1,
		startedAt: '2024-01-01T00:00:00.000Z',
		completedAt: '2024-01-02T00:00:00.000Z',
		...overrides,
	} satisfies LibraryImportItem)
}

async function batch(
	ownerId: string,
	items: Array<{
		sourceKey: string
		mediaId: string | null
		resolution: string
		payload: string
	}>,
) {
	return prisma.libraryImportBatch.create({
		data: {
			ownerId,
			provider: 'myanimelist',
			fileName: 'fixture.xml',
			itemCount: items.length,
			matchedCount: items.filter(item => item.mediaId).length,
			ambiguousCount: 0,
			unmatchedCount: items.filter(item => !item.mediaId).length,
			conflictCount: 0,
			items: {
				create: items.map(item => ({
					...item,
					matchState: item.mediaId ? 'matched' : 'unmatched',
					matchMethod: item.mediaId ? 'exact-title' : null,
				})),
			},
		},
	})
}

test('atomically applies a new import and rolls it back exactly', async () => {
	await animeListType()
	const [member, work] = await Promise.all([
		owner(),
		media(`New import ${suffix()}`),
	])
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:new',
			mediaId: work.id,
			resolution: 'add',
			payload: payload('mal:anime:new', work.title!),
		},
	])

	await prisma.$transaction(tx =>
		applyLibraryImportBatch(tx, {
			ownerId: member.id,
			batchId: importBatch.id,
		}),
	)
	const applied = await prisma.trackingState.findUniqueOrThrow({
		where: { ownerId_mediaId: { ownerId: member.id, mediaId: work.id } },
		include: { progress: true, statusWatchlist: true },
	})
	expect(applied).toEqual(
		expect.objectContaining({
			status: 'completed',
			score: expect.objectContaining({}),
			repeatCount: 1,
			progress: [expect.objectContaining({ unit: 'episode', current: 12 })],
			statusWatchlist: expect.objectContaining({ isPublic: false }),
		}),
	)
	expect(Number(applied.score)).toBe(9)
	expect(
		await prisma.activityEvent.findMany({
			where: { actorId: member.id, mediaId: work.id },
			select: { type: true, isPublic: true },
		}),
	).toEqual([{ type: 'library_import', isPublic: false }])
	await expect(
		prisma.$transaction(tx =>
			applyLibraryImportBatch(tx, {
				ownerId: member.id,
				batchId: importBatch.id,
			}),
		),
	).rejects.toEqual(
		expect.objectContaining<Partial<LibraryImportError>>({ status: 409 }),
	)

	await prisma.$transaction(tx =>
		rollbackLibraryImportBatch(tx, {
			ownerId: member.id,
			batchId: importBatch.id,
		}),
	)
	expect(
		await prisma.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId: member.id, mediaId: work.id } },
		}),
	).toBeNull()
	expect(
		await prisma.entry.count({
			where: { mediaId: work.id, watchlist: { ownerId: member.id } },
		}),
	).toBe(0)
	expect(
		await prisma.activityEvent.count({
			where: {
				actorId: member.id,
				mediaId: work.id,
				type: 'import_rollback',
			},
		}),
	).toBe(1)
})

test('merge preserves stronger progress and rollback restores prior state', async () => {
	const type = await animeListType()
	const [member, work] = await Promise.all([
		owner(),
		media(`Merge import ${suffix()}`),
	])
	const watching = await prisma.watchlist.create({
		data: {
			ownerId: member.id,
			typeId: type.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
			isPublic: false,
		},
	})
	const state = await prisma.trackingState.create({
		data: {
			ownerId: member.id,
			mediaId: work.id,
			status: 'watching',
			statusWatchlistId: watching.id,
			score: 6,
			repeatCount: 3,
			progress: {
				create: { unit: 'episode', current: 18, total: 24 },
			},
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watching.id,
			mediaId: work.id,
			trackingStateId: state.id,
			position: 1,
			title: work.title!,
			personal: 6,
			history: '{"fixture":"before"}',
		},
	})
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:merge',
			mediaId: work.id,
			resolution: 'merge',
			payload: payload('mal:anime:merge', work.title!, {
				progress: { episodes: 12 },
				repeatCount: 1,
			}),
		},
	])

	await prisma.$transaction(tx =>
		applyLibraryImportBatch(tx, {
			ownerId: member.id,
			batchId: importBatch.id,
		}),
	)
	const merged = await prisma.trackingState.findUniqueOrThrow({
		where: { id: state.id },
		include: { progress: true },
	})
	expect(merged.repeatCount).toBe(3)
	expect(merged.progress[0]).toEqual(
		expect.objectContaining({ current: 18, total: 24 }),
	)

	await prisma.$transaction(tx =>
		rollbackLibraryImportBatch(tx, {
			ownerId: member.id,
			batchId: importBatch.id,
		}),
	)
	const restored = await prisma.trackingState.findUniqueOrThrow({
		where: { id: state.id },
		include: { progress: true },
	})
	expect(Number(restored.score)).toBe(6)
	expect(restored.status).toBe('watching')
	expect(restored.repeatCount).toBe(3)
	expect(restored.progress[0]).toEqual(
		expect.objectContaining({ current: 18, total: 24 }),
	)
	expect(await prisma.entry.findUnique({ where: { id: entry.id } })).toEqual(
		expect.objectContaining({
			watchlistId: watching.id,
			position: 1,
			history: '{"fixture":"before"}',
		}),
	)
})

test('rollback refuses to overwrite a post-import edit', async () => {
	await animeListType()
	const [member, work] = await Promise.all([
		owner(),
		media(`Edited import ${suffix()}`),
	])
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:edited',
			mediaId: work.id,
			resolution: 'add',
			payload: payload('mal:anime:edited', work.title!),
		},
	])
	await prisma.$transaction(tx =>
		applyLibraryImportBatch(tx, {
			ownerId: member.id,
			batchId: importBatch.id,
		}),
	)
	await prisma.trackingState.update({
		where: { ownerId_mediaId: { ownerId: member.id, mediaId: work.id } },
		data: { score: 7 },
	})

	await expect(
		prisma.$transaction(tx =>
			rollbackLibraryImportBatch(tx, {
				ownerId: member.id,
				batchId: importBatch.id,
			}),
		),
	).rejects.toEqual(
		expect.objectContaining<Partial<LibraryImportError>>({
			status: 409,
		}),
	)
	expect(
		(
			await prisma.trackingState.findUniqueOrThrow({
				where: {
					ownerId_mediaId: { ownerId: member.id, mediaId: work.id },
				},
			})
		).score?.toString(),
	).toBe('7')
})

test('preflight rejects an unresolved selected row before any mutation', async () => {
	await animeListType()
	const [member, work] = await Promise.all([
		owner(),
		media(`Atomic import ${suffix()}`),
	])
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:valid',
			mediaId: work.id,
			resolution: 'add',
			payload: payload('mal:anime:valid', work.title!),
		},
		{
			sourceKey: 'mal:anime:invalid',
			mediaId: null,
			resolution: 'add',
			payload: payload('mal:anime:invalid', 'Missing'),
		},
	])
	await expect(
		prisma.$transaction(tx =>
			applyLibraryImportBatch(tx, {
				ownerId: member.id,
				batchId: importBatch.id,
			}),
		),
	).rejects.toBeInstanceOf(LibraryImportError)
	expect(
		await prisma.trackingState.count({
			where: { ownerId: member.id },
		}),
	).toBe(0)
})
