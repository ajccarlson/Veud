import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { claimWatchlistRevisions } from './watchlist-revision.server.ts'

async function watchlistFixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `revision_${suffix}@example.com`,
			username: `revision_${suffix}`,
		},
	})
	const type = await prisma.listType.create({
		data: {
			name: `revision_${suffix}`,
			header: 'Revision test',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{"past":"watched"}',
		},
	})
	return prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: type.id,
			name: 'watching',
			header: 'Watching',
		},
		select: { id: true, mutationVersion: true },
	})
}

test('a stale revision rolls back entry writes with a conflict', async () => {
	const watchlist = await watchlistFixture()
	await prisma.watchlist.update({
		where: { id: watchlist.id },
		data: { mutationVersion: { increment: 1 } },
	})
	const response = await prisma
		.$transaction(async transaction => {
			await transaction.entry.create({
				data: {
					watchlistId: watchlist.id,
					position: 1,
					title: 'Must roll back',
				},
			})
			await claimWatchlistRevisions(transaction, [watchlist])
		})
		.catch(error => error)

	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(409)
	expect(
		await prisma.entry.count({ where: { watchlistId: watchlist.id } }),
	).toBe(0)
})

test('a current revision is claimed exactly once', async () => {
	const watchlist = await watchlistFixture()
	await prisma.$transaction(transaction =>
		claimWatchlistRevisions(transaction, [watchlist, watchlist]),
	)
	expect(
		(
			await prisma.watchlist.findUniqueOrThrow({
				where: { id: watchlist.id },
				select: { mutationVersion: true },
			})
		).mutationVersion,
	).toBe(watchlist.mutationVersion + 1)
})
