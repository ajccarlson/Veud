import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { updateEntryCellCommand } from '#app/utils/lists/commands/update-entry-cell.server.ts'

async function createUserRecord() {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	return prisma.user.create({
		data: { email: `${suffix}@example.com`, username: `u_${suffix}` },
		select: { id: true },
	})
}

async function createOwnerWithEntry() {
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
							columns: JSON.stringify({
								title: 'string',
								personal: 'number',
								watchlistId: 'string',
							}),
							mediaType: '["movie"]',
							completionType: 'watched',
						},
					},
					entries: {
						create: { position: 1, title: 'Original Title' },
					},
				},
			},
		},
		select: {
			id: true,
			watchlists: {
				select: { typeId: true, entries: { select: { id: true } } },
			},
		},
	})
	const wl = owner.watchlists[0]
	const entryId = wl?.entries[0]?.id
	if (!wl || !entryId) throw new Error('test setup: entry was not created')
	return { userId: owner.id, entryId }
}

function updateTitleParams(entryId: string, newValue: string) {
	return { entryId, columnId: 'title', value: newValue }
}

test('the owner can update a cell', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	const result = await updateEntryCellCommand(
		userId,
		updateTitleParams(entryId, 'Updated Title'),
	)

	expect((result as { title?: string }).title).toBe('Updated Title')
})

test('a regular cell edit preserves current history and refreshes its timestamp', async () => {
	const { userId, entryId } = await createOwnerWithEntry()
	await prisma.entry.update({
		where: { id: entryId },
		data: {
			history: JSON.stringify({
				added: 1,
				progress: { episode: 7 },
				concurrentMarker: 'keep',
				lastUpdated: 2,
			}),
		},
	})
	await updateEntryCellCommand(
		userId,
		updateTitleParams(entryId, 'History-safe title'),
	)

	const saved = await prisma.entry.findUniqueOrThrow({
		where: { id: entryId },
		select: { history: true },
	})
	const history = JSON.parse(saved.history ?? '{}') as {
		progress?: { episode?: number }
		concurrentMarker?: string
		lastUpdated?: number
	}
	expect(history.progress?.episode).toBe(7)
	expect(history.concurrentMarker).toBe('keep')
	expect(history.lastUpdated).toBeGreaterThan(2)
})

test('a logged-in non-owner cannot update the cell (404)', async () => {
	const { entryId } = await createOwnerWithEntry()
	const other = await createUserRecord()

	const res = await updateEntryCellCommand(
		other.id,
		updateTitleParams(entryId, 'Hacked'),
	).catch(e => e)

	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(404)
})

test('protected columns cannot be changed through the generic cell endpoint', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	const res = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'watchlistId',
		value: 'attacker-controlled-watchlist',
	}).catch(e => e)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(400)
})

test('column values are cast from the server schema and reject invalid numbers', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	const res = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'personal',
		value: 'not-a-number',
	}).catch(error => error)
	expect(res).toBeInstanceOf(Response)
	expect((res as Response).status).toBe(400)
})
