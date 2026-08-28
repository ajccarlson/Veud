import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import { createPublicSurfaceCacheRuntimeForTest } from './public-surface-cache.server.ts'
import {
	getRootListTypes,
	parseRootListTypes,
	ROOT_LIST_TYPES_TTL_MS,
} from './root-reference-data.server.ts'

test('caches a minimal, validated, deterministically ordered projection', async () => {
	const findMany = vi.spyOn(prisma.listType, 'findMany').mockResolvedValue([
		{ id: 'custom-id', name: 'custom', header: 'Custom' },
		{ id: 'manga-id', name: 'manga', header: 'Manga' },
		{ id: 'live-id', name: 'liveaction', header: 'Live Action' },
		{ id: 'anime-id', name: 'anime', header: 'Anime' },
	] as never)
	const runtime = createPublicSurfaceCacheRuntimeForTest()

	const first = await getRootListTypes({ runtime })
	const second = await getRootListTypes({ runtime })

	expect(findMany).toHaveBeenCalledTimes(1)
	expect(findMany).toHaveBeenCalledWith({
		orderBy: [{ name: 'asc' }, { id: 'asc' }],
		take: 17,
		select: { id: true, name: true, header: true },
	})
	expect(first).toEqual([
		{ id: 'live-id', name: 'liveaction', header: 'Live Action' },
		{ id: 'anime-id', name: 'anime', header: 'Anime' },
		{ id: 'manga-id', name: 'manga', header: 'Manga' },
		{ id: 'custom-id', name: 'custom', header: 'Custom' },
	])
	expect(second).toEqual(first)
	expect(second).not.toBe(first)
	expect(Object.isFrozen(second)).toBe(true)
	expect(Object.isFrozen(second[0])).toBe(true)
	expect(ROOT_LIST_TYPES_TTL_MS).toBe(300_000)
})

test('rejects oversized, duplicate, or expanded cache payloads', () => {
	expect(() =>
		parseRootListTypes([
			{ id: 'anime-id', name: 'anime', header: 'Anime' },
			{ id: 'live-id', name: 'liveaction', header: 'Live Action' },
		]),
	).toThrow(/canonical navigation order/)
	expect(() =>
		parseRootListTypes([
			{ id: 'one', name: 'liveaction', header: 'Live Action' },
			{ id: 'one', name: 'anime', header: 'Anime' },
		]),
	).toThrow(/unique/)
	expect(() =>
		parseRootListTypes([
			{ id: 'one', name: 'anime', header: 'Anime' },
			{ id: 'two', name: 'anime', header: 'Anime duplicate' },
		]),
	).toThrow(/unique/)
	expect(() =>
		parseRootListTypes([
			{ id: 'one', name: 'anime', header: 'Anime', columns: '{}' },
		]),
	).toThrow()
	expect(() =>
		parseRootListTypes(
			Array.from({ length: 17 }, (_, index) => ({
				id: `id-${index}`,
				name: `type-${index}`,
				header: `Type ${index}`,
			})),
		),
	).toThrow()
})
