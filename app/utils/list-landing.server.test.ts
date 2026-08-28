import { faker } from '@faker-js/faker'
import { type Prisma, type PrismaClient } from '@prisma/client'
import { expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	LIST_LANDING_PREVIEW_LIMIT,
	loadListLandingPreviews,
} from './list-landing.server.ts'

test('uses one ranked query and hydrates only the fixed preview budget', async () => {
	const watchlistId = 'private-list-id'
	const rankedRows = Array.from(
		{ length: LIST_LANDING_PREVIEW_LIMIT },
		(_, index) => ({
			id: `entry-${index + 1}`,
			watchlistId,
			entryCount: 1_000n,
			previewRank: BigInt(index + 1),
		}),
	)
	const queryRaw = vi.fn().mockResolvedValue(rankedRows)
	const findMany = vi.fn().mockResolvedValue(
		[...rankedRows].reverse().map((row, index) => ({
			id: row.id,
			watchlistId,
			position: LIST_LANDING_PREVIEW_LIMIT - index,
			thumbnail: null,
			title: row.id,
			type: 'TV',
			airYear: null,
			startSeason: null,
			startYear: null,
			media: null,
		})),
	)
	const db = {
		$queryRaw: queryRaw,
		entry: { findMany },
	} as unknown as Pick<PrismaClient, '$queryRaw' | 'entry'>

	const result = await loadListLandingPreviews(db, [watchlistId, watchlistId])

	expect(queryRaw).toHaveBeenCalledTimes(1)
	const query = queryRaw.mock.calls[0]?.[0] as Prisma.Sql
	expect(query.sql).toContain('COUNT(*) OVER')
	expect(query.sql).toContain('ROW_NUMBER() OVER')
	expect(query.sql).toContain('ORDER BY entry."position" ASC, entry."id" ASC')
	expect(query.sql).not.toContain(watchlistId)
	expect(query.values).toEqual(
		expect.arrayContaining([watchlistId, LIST_LANDING_PREVIEW_LIMIT]),
	)
	expect(findMany).toHaveBeenCalledTimes(1)
	expect(findMany.mock.calls[0]?.[0]).toMatchObject({
		where: { id: { in: rankedRows.map(row => row.id) } },
	})
	expect(result.get(watchlistId)).toEqual({
		entryCount: 1_000,
		listEntries: rankedRows.map(row => expect.objectContaining({ id: row.id })),
	})
})

test('returns exact counts and canonical ordered previews from SQLite', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `landing_${suffix}@example.com`,
			username: `landing_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `landing-${suffix}`,
			header: 'Landing previews',
			columns: '{"title":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
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
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Canonical romaji title',
			englishTitle: 'Canonical English title',
			thumbnail: 'https://example.com/canonical.jpg',
		},
	})
	const positions = [70, 10, 60, 20, 50, 30, 40]
	await prisma.entry.createMany({
		data: positions.map(position => ({
			watchlistId: watchlist.id,
			mediaId: position === 10 ? media.id : null,
			position,
			title: position === 10 ? 'Stale title' : `Title ${position}`,
			thumbnail: null,
		})),
	})

	const result = await loadListLandingPreviews(
		prisma,
		[watchlist.id],
		'english',
	)
	const preview = result.get(watchlist.id)

	expect(preview?.entryCount).toBe(positions.length)
	expect(preview?.listEntries).toHaveLength(LIST_LANDING_PREVIEW_LIMIT)
	expect(preview?.listEntries.map(entry => entry.position)).toEqual([
		10, 20, 30, 40, 50,
	])
	expect(preview?.listEntries[0]).toMatchObject({
		title: 'Canonical English title',
		thumbnail: 'https://example.com/canonical.jpg',
	})
})

test('does not query entries for an empty watchlist set', async () => {
	const queryRaw = vi.fn()
	const findMany = vi.fn()
	const db = {
		$queryRaw: queryRaw,
		entry: { findMany },
	} as unknown as Pick<PrismaClient, '$queryRaw' | 'entry'>

	await expect(loadListLandingPreviews(db, [])).resolves.toEqual(new Map())
	expect(queryRaw).not.toHaveBeenCalled()
	expect(findMany).not.toHaveBeenCalled()
})
