import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createWatchlistCommand } from '#app/utils/lists/commands/create-watchlist.server.ts'
import {
	MAX_WATCHLISTS_PER_TYPE,
	MAX_WATCHLISTS_PER_USER,
} from '#app/utils/watchlist-limits.ts'

async function fixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `create_list_${suffix}@example.com`,
			username: `create_list_${suffix}`,
		},
	})
	const type = await prisma.listType.create({
		data: {
			name: `create_list_${suffix}`,
			header: 'Movies',
			columns: '{}',
			mediaType: '["movie"]',
			completionType: '{"past":"watched"}',
		},
	})
	return { owner, type }
}

function validList(typeId: string) {
	return {
		position: 1,
		name: 'watching',
		header: 'Watching',
		typeId,
		displayedColumns: '["title"]',
		description: '',
	}
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

test('creates only validated server-owned watchlist fields', async () => {
	const data = await fixture()
	const created = await createWatchlistCommand(data.owner.id, {
		...validList(data.type.id),
		id: 'attacker-controlled-id',
		entries: {
			create: { title: 'Injected entry', position: 1 },
		},
	})

	expect(created).toMatchObject({
		ownerId: data.owner.id,
		typeId: data.type.id,
		position: 1,
		isPublic: true,
	})
	expect(created.id).not.toBe('attacker-controlled-id')
	expect(await prisma.entry.count({ where: { watchlistId: created.id } })).toBe(
		0,
	)
})

test('rejects malformed and oversized watchlist fields', async () => {
	const data = await fixture()
	for (const list of [
		{ ...validList(data.type.id), name: '' },
		{
			...validList(data.type.id),
			description: 'x'.repeat(5_001),
		},
	]) {
		const response = await createWatchlistCommand(data.owner.id, list).catch(
			error => error,
		)
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(400)
	}
})

test('allows 50 watchlists per type and rejects the next without reordering', async () => {
	const data = await fixture()
	await seedWatchlists({
		ownerId: data.owner.id,
		typeId: data.type.id,
		count: MAX_WATCHLISTS_PER_TYPE - 1,
		prefix: 'type-limit',
	})

	const boundary = await createWatchlistCommand(
		data.owner.id,
		validList(data.type.id),
	)
	expect(boundary.position).toBe(1)
	expect(
		await prisma.watchlist.count({
			where: { ownerId: data.owner.id, typeId: data.type.id },
		}),
	).toBe(MAX_WATCHLISTS_PER_TYPE)

	const response = await createWatchlistCommand(
		data.owner.id,
		validList(data.type.id),
	).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(409)
	expect(await (response as Response).text()).toContain(
		`${MAX_WATCHLISTS_PER_TYPE} watchlists for each media type`,
	)
	expect(
		await prisma.watchlist.findFirstOrThrow({
			where: {
				ownerId: data.owner.id,
				typeId: data.type.id,
				name: 'watching',
			},
			select: { position: true },
		}),
	).toEqual({ position: 1 })
})

test('allows 100 watchlists in total and rejects the next', async () => {
	const data = await fixture()
	const secondType = await prisma.listType.create({
		data: {
			name: `second_${data.type.id}`,
			header: 'Television',
			columns: '{}',
			mediaType: '["series"]',
			completionType: '{"past":"watched"}',
		},
	})
	const thirdType = await prisma.listType.create({
		data: {
			name: `third_${data.type.id}`,
			header: 'Manga',
			columns: '{}',
			mediaType: '["chapter"]',
			completionType: '{"past":"read"}',
		},
	})
	await seedWatchlists({
		ownerId: data.owner.id,
		typeId: data.type.id,
		count: MAX_WATCHLISTS_PER_TYPE,
		prefix: 'total-a',
	})
	await seedWatchlists({
		ownerId: data.owner.id,
		typeId: secondType.id,
		count: MAX_WATCHLISTS_PER_USER - MAX_WATCHLISTS_PER_TYPE - 1,
		prefix: 'total-b',
	})

	await createWatchlistCommand(data.owner.id, validList(thirdType.id))
	expect(
		await prisma.watchlist.count({ where: { ownerId: data.owner.id } }),
	).toBe(MAX_WATCHLISTS_PER_USER)

	const response = await createWatchlistCommand(
		data.owner.id,
		validList(thirdType.id),
	).catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(409)
	expect(await (response as Response).text()).toContain(
		`${MAX_WATCHLISTS_PER_USER} watchlists`,
	)
	expect(
		await prisma.watchlist.count({ where: { ownerId: data.owner.id } }),
	).toBe(MAX_WATCHLISTS_PER_USER)
})
