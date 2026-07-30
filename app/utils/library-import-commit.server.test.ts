import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	applyLibraryImportBatch,
	LibraryImportError,
	rollbackLibraryImportBatch,
} from './library-import-commit.server.ts'
import { type LibraryImportItem } from './library-import.ts'
import { syncWatchlistActivityVisibility } from './lists/activity-visibility.server.ts'
import {
	MAX_WATCHLISTS_PER_TYPE,
	MAX_WATCHLISTS_PER_USER,
} from './watchlist-limits.ts'

function suffix() {
	return faker.string.alphanumeric({ length: 10 }).toLowerCase()
}

test('imports the library writer without request-session credentials', () => {
	const environment = { ...process.env }
	Reflect.deleteProperty(environment, 'SESSION_SECRET')
	const moduleUrl = pathToFileURL(
		path.join(process.cwd(), 'app/utils/library-import-commit.server.ts'),
	).href
	const result = spawnSync(
		process.execPath,
		[
			'--import',
			'tsx',
			'--input-type=module',
			'--eval',
			`await import(${JSON.stringify(moduleUrl)})`,
		],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			env: environment,
		},
	)

	expect(result.status, result.stderr).toBe(0)
})

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

async function auxiliaryListType(name: string) {
	return prisma.listType.create({
		data: {
			name,
			header: name,
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
	})
}

async function seedWatchlists({
	ownerId,
	typeId,
	count,
	prefix,
}: {
	ownerId: string
	typeId: string
	count: number
	prefix: string
}) {
	await prisma.watchlist.createMany({
		data: Array.from({ length: count }, (_, index) => ({
			ownerId,
			typeId,
			position: index + 1,
			name: `${prefix}-${index + 1}`,
			header: `${prefix} ${index + 1}`,
		})),
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
	const type = await animeListType()
	const [member, foreignOwner, work] = await Promise.all([
		owner(),
		owner(),
		media(`New import ${suffix()}`),
	])
	const foreignList = await prisma.watchlist.create({
		data: {
			ownerId: foreignOwner.id,
			typeId: type.id,
			name: 'private-import-source',
			header: 'Private import source',
			isPublic: false,
		},
	})
	const foreignMetadata = {
		title: 'PRIVATE IMPORT TITLE MUST NOT ESCAPE',
		description: 'PRIVATE IMPORT DESCRIPTION MUST NOT ESCAPE',
		thumbnail: 'https://private.example/import-cover.jpg',
	}
	await prisma.entry.create({
		data: {
			watchlistId: foreignList.id,
			mediaId: work.id,
			position: 1,
			...foreignMetadata,
		},
	})
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
	const importedEntry = await prisma.entry.findFirstOrThrow({
		where: { mediaId: work.id, watchlist: { ownerId: member.id } },
	})
	expect(importedEntry.title).toBe(work.title)
	const importedSnapshot = JSON.stringify(importedEntry)
	for (const privateValue of Object.values(foreignMetadata)) {
		expect(importedSnapshot).not.toContain(privateValue)
	}
	expect(importedEntry.length).toBe('12 eps')
	expect(JSON.parse(importedEntry.history ?? '{}')).toEqual(
		expect.objectContaining({
			progress: {},
			repeatCount: 1,
			started: new Date('2024-01-01T00:00:00.000Z').getTime(),
			finished: new Date('2024-01-02T00:00:00.000Z').getTime(),
		}),
	)
	expect(
		await prisma.activityEvent.findMany({
			where: { actorId: member.id, mediaId: work.id },
			select: { type: true, isPublic: true, publicEligible: true },
		}),
	).toEqual([
		{ type: 'library_import', isPublic: false, publicEligible: false },
	])
	if (!applied.statusWatchlistId) {
		throw new Error('test setup: import destination list was not created')
	}
	await prisma.$transaction(async tx => {
		const published = await tx.watchlist.update({
			where: { id: applied.statusWatchlistId! },
			data: { isPublic: true },
		})
		await syncWatchlistActivityVisibility(tx, published)
	})
	expect(
		await prisma.activityEvent.findFirstOrThrow({
			where: {
				actorId: member.id,
				mediaId: work.id,
				type: 'library_import',
			},
			select: { isPublic: true, publicEligible: true },
		}),
	).toEqual({ isPublic: false, publicEligible: false })
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

	const storedItem = await prisma.libraryImportItem.findFirstOrThrow({
		where: { batchId: importBatch.id },
	})
	const legacyJournal = JSON.parse(storedItem.journal ?? '{}') as {
		before: { entries: Array<Record<string, unknown>> }
		after: { entries: Array<Record<string, unknown>> }
	}
	for (const snapshot of [legacyJournal.before, legacyJournal.after]) {
		for (const journalEntry of snapshot.entries) {
			delete journalEntry.length
			delete journalEntry.chapters
			delete journalEntry.volumes
		}
	}
	await prisma.libraryImportItem.update({
		where: { id: storedItem.id },
		data: { journal: JSON.stringify(legacyJournal) },
	})
	const linkedActivity = await prisma.activityEvent.create({
		data: {
			type: 'score',
			actorId: member.id,
			mediaId: work.id,
			trackingStateId: applied.id,
			statusWatchlistId: applied.statusWatchlistId,
			score: 9,
			isPublic: true,
			publicEligible: true,
		},
	})

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
	expect(
		await prisma.activityEvent.findUniqueOrThrow({
			where: { id: linkedActivity.id },
			select: {
				statusWatchlistId: true,
				isPublic: true,
				publicEligible: true,
			},
		}),
	).toEqual({
		statusWatchlistId: null,
		isPublic: false,
		publicEligible: true,
	})
})

test('rejects an import-created list at the per-type limit', async () => {
	const type = await animeListType()
	const [member, work] = await Promise.all([
		owner(),
		media(`Type-limited import ${suffix()}`),
	])
	await seedWatchlists({
		ownerId: member.id,
		typeId: type.id,
		count: MAX_WATCHLISTS_PER_TYPE,
		prefix: 'type-limit',
	})
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:type-limit',
			mediaId: work.id,
			resolution: 'add',
			payload: payload('mal:anime:type-limit', work.title!),
		},
	])

	await expect(
		prisma.$transaction(tx =>
			applyLibraryImportBatch(tx, {
				ownerId: member.id,
				batchId: importBatch.id,
			}),
		),
	).rejects.toEqual(
		expect.objectContaining<Partial<LibraryImportError>>({
			status: 409,
			message: expect.stringContaining(
				`${MAX_WATCHLISTS_PER_TYPE} watchlists for each media type`,
			),
		}),
	)
	expect(
		await prisma.libraryImportBatch.findUniqueOrThrow({
			where: { id: importBatch.id },
			select: { status: true },
		}),
	).toEqual({ status: 'previewed' })
	expect(
		await prisma.trackingState.count({ where: { ownerId: member.id } }),
	).toBe(0)
})

test('reuses an existing import list at the per-type limit', async () => {
	const type = await animeListType()
	const [member, work] = await Promise.all([
		owner(),
		media(`Existing-list import ${suffix()}`),
	])
	const completed = await prisma.watchlist.create({
		data: {
			ownerId: member.id,
			typeId: type.id,
			position: 1,
			name: 'completed',
			header: 'Completed',
			isPublic: false,
		},
	})
	await seedWatchlists({
		ownerId: member.id,
		typeId: type.id,
		count: MAX_WATCHLISTS_PER_TYPE - 1,
		prefix: 'existing-limit',
	})
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:existing-limit',
			mediaId: work.id,
			resolution: 'add',
			payload: payload('mal:anime:existing-limit', work.title!),
		},
	])

	await prisma.$transaction(tx =>
		applyLibraryImportBatch(tx, {
			ownerId: member.id,
			batchId: importBatch.id,
		}),
	)

	expect(
		await prisma.watchlist.count({
			where: { ownerId: member.id, typeId: type.id },
		}),
	).toBe(MAX_WATCHLISTS_PER_TYPE)
	expect(
		await prisma.trackingState.findUniqueOrThrow({
			where: { ownerId_mediaId: { ownerId: member.id, mediaId: work.id } },
			select: { statusWatchlistId: true },
		}),
	).toEqual({ statusWatchlistId: completed.id })
})

test('rejects an import-created list at the total limit', async () => {
	const type = await animeListType()
	const id = suffix()
	const [member, work, secondType, thirdType] = await Promise.all([
		owner(),
		media(`Total-limited import ${id}`),
		auxiliaryListType(`import-total-b-${id}`),
		auxiliaryListType(`import-total-c-${id}`),
	])
	await seedWatchlists({
		ownerId: member.id,
		typeId: type.id,
		count: MAX_WATCHLISTS_PER_TYPE - 1,
		prefix: 'total-limit-a',
	})
	await seedWatchlists({
		ownerId: member.id,
		typeId: secondType.id,
		count: MAX_WATCHLISTS_PER_TYPE,
		prefix: 'total-limit-b',
	})
	await seedWatchlists({
		ownerId: member.id,
		typeId: thirdType.id,
		count:
			MAX_WATCHLISTS_PER_USER -
			(MAX_WATCHLISTS_PER_TYPE - 1) -
			MAX_WATCHLISTS_PER_TYPE,
		prefix: 'total-limit-c',
	})
	const importBatch = await batch(member.id, [
		{
			sourceKey: 'mal:anime:total-limit',
			mediaId: work.id,
			resolution: 'add',
			payload: payload('mal:anime:total-limit', work.title!),
		},
	])

	await expect(
		prisma.$transaction(tx =>
			applyLibraryImportBatch(tx, {
				ownerId: member.id,
				batchId: importBatch.id,
			}),
		),
	).rejects.toEqual(
		expect.objectContaining<Partial<LibraryImportError>>({
			status: 409,
			message: expect.stringContaining(`${MAX_WATCHLISTS_PER_USER} watchlists`),
		}),
	)
	expect(await prisma.watchlist.count({ where: { ownerId: member.id } })).toBe(
		MAX_WATCHLISTS_PER_USER,
	)
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
	expect(
		await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } }),
	).toEqual(
		expect.objectContaining({
			length: '18 / 24 eps',
			history: expect.stringContaining('"fixture":"before"'),
		}),
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
			length: null,
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
