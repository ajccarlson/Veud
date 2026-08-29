import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { deleteEmptyEntriesCommand } from '#app/utils/lists/commands/delete-empty-entries.server.ts'

async function createUserRecord() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
		select: { id: true },
	})
}

// Seeds a watchlist with two "empty" rows (blank / whitespace-only title, no type) and one
// real row, so we can assert exactly which rows the action removes.
async function seedWatchlistWithEntries() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `${suffix}@example.com`,
			username: `u_${suffix}`,
			watchlists: {
				create: {
					name: faker.lorem.words(2),
					header: 'LiveAction',
					type: {
						create: {
							name: `LiveAction ${suffix}`,
							header: 'LiveAction',
							columns: '[]',
							mediaType: 'liveAction',
							completionType: 'watched',
						},
					},
					entries: {
						create: [
							{ position: 1, title: '' },
							{ position: 2, title: 'Kept Movie' },
							{ position: 3, title: '   ' },
						],
					},
				},
			},
		},
		select: { id: true, watchlists: { select: { id: true, typeId: true } } },
	})
	const wl = owner.watchlists[0]
	if (!wl) throw new Error('test setup: watchlist was not created')
	return { userId: owner.id, watchlistId: wl.id, listTypeId: wl.typeId }
}

test('removes only the empty rows and keeps the real one', async () => {
	const { userId, watchlistId } = await seedWatchlistWithEntries()

	const removed = await deleteEmptyEntriesCommand(userId, watchlistId)

	expect(Array.isArray(removed)).toBe(true)
	expect((removed as unknown[]).length).toBe(2)

	const remaining = await prisma.entry.findMany({
		where: { watchlistId },
	})
	expect(remaining.length).toBe(1)
	expect(remaining[0]?.title).toBe('Kept Movie')
	expect(remaining[0]?.position).toBe(1)
})

test('a logged-in non-owner cannot delete rows (404, nothing removed)', async () => {
	const { watchlistId } = await seedWatchlistWithEntries()
	const other = await createUserRecord()

	const res = await deleteEmptyEntriesCommand(other.id, watchlistId).catch(
		e => e,
	)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)

	const remaining = await prisma.entry.findMany({
		where: { watchlistId },
	})
	expect(remaining.length).toBe(3)
})
