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
								notes: 'string',
								priority: 'string',
								story: 'number',
								personal: 'number',
								averaged: 'number',
								tmdbScore: 'number',
								releaseStart: 'date',
								startDate: 'history',
								finishedDate: 'history',
								dateAdded: 'history',
								lastUpdated: 'history',
								length: 'string',
								watchlistId: 'string',
							}),
							mediaType: '["episode"]',
							completionType: 'watched',
						},
					},
					entries: {
						create: {
							position: 1,
							title: 'Original Title',
							story: 5,
							personal: 7,
							length: '12 eps',
						},
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
	return { userId: owner.id, entryId, listTypeId: wl.typeId }
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

test('cell values use bounded score schemas and clear scores to null', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	for (const [columnId, value] of [
		['personal', 'not-a-number'],
		['personal', 11],
		['story', 1.5],
		['story', -1],
	] as const) {
		const response = await updateEntryCellCommand(userId, {
			entryId,
			columnId,
			value,
		}).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}

	const cleared = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'personal',
		value: null,
	})
	expect(cleared.personal).toBeNull()
	expect(cleared.story).toBe(5)
})

test('computed and server-managed columns stay read-only', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	for (const columnId of ['averaged', 'tmdbScore', 'added', 'lastUpdated']) {
		const response = await updateEntryCellCommand(userId, {
			entryId,
			columnId,
			value: 9,
		}).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}
})

test('configured column types must exactly match their field rule', async () => {
	const { userId, entryId, listTypeId } = await createOwnerWithEntry()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { id: listTypeId },
		select: { columns: true },
	})
	await prisma.listType.update({
		where: { id: listTypeId },
		data: {
			columns: JSON.stringify({
				...(JSON.parse(listType.columns) as Record<string, unknown>),
				story: 'string',
			}),
		},
	})

	const response = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'story',
		value: 8,
	}).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(400)
})

test('text schemas preserve nulls and enforce field limits', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	const cleared = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'notes',
		value: null,
	})
	expect(cleared.notes).toBeNull()

	for (const [columnId, value] of [
		['notes', 'x'.repeat(5_001)],
		['title', null],
	] as const) {
		const response = await updateEntryCellCommand(userId, {
			entryId,
			columnId,
			value,
		}).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}
})

test('dates and progress use exact field schemas', async () => {
	const { userId, entryId } = await createOwnerWithEntry()

	for (const [columnId, value] of [
		['releaseStart', '2026-02-30'],
		['releaseStart', '2026-02-28T99:99:99.000Z'],
		['started', 'next Tuesday'],
		['length', '13 / 12 eps'],
		['length', 'episode three'],
	] as const) {
		const response = await updateEntryCellCommand(userId, {
			entryId,
			columnId,
			value,
		}).catch(error => error)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}

	const dated = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'releaseStart',
		value: '2026-02-28T18:30:00.000Z',
	})
	expect(dated.releaseStart?.toISOString()).toBe('2026-02-28T00:00:00.000Z')

	const progressed = await updateEntryCellCommand(userId, {
		entryId,
		columnId: 'length',
		value: '3 / 12 eps',
	})
	const history = JSON.parse(progressed.history ?? '{}') as {
		progress?: Record<string, { completed?: boolean }>
	}
	expect(history.progress?.['3']?.completed).toBe(true)
})
