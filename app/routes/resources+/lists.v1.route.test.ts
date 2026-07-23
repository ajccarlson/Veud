import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader as entriesLoader } from './lists.v1.entries.ts'
import { action } from './lists.v1.ts'

async function fixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [owner, other] = await Promise.all([
		prisma.user.create({
			data: {
				email: `list_v1_owner_${suffix}@example.com`,
				username: `list_v1_owner_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `list_v1_other_${suffix}@example.com`,
				username: `list_v1_other_${suffix}`,
			},
		}),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `list_v1_${suffix}`,
			header: 'List API test',
			columns: JSON.stringify({
				title: 'string',
				personal: 'number',
				watchlistId: 'string',
			}),
			mediaType: '["movie"]',
			completionType: 'watched',
		},
	})
	const [source, destination, otherList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'watching',
				header: 'Watching',
				position: 1,
				entries: {
					create: { title: 'Versioned mutation fixture', position: 1 },
				},
			},
			include: { entries: true },
		}),
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'completed',
				header: 'Completed',
				position: 2,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: other.id,
				typeId: listType.id,
				name: 'other',
				header: 'Other',
			},
		}),
	])
	const session = await prisma.session.create({
		data: { userId: owner.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		owner,
		source,
		destination,
		otherList,
		entry: source.entries[0],
		cookie: await getSessionCookieHeader(session),
	}
}

function mutationRequest(
	intent: string,
	input: Record<string, unknown>,
	cookie?: string,
) {
	return new Request(`${BASE_URL}/resources/lists/v1`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify({ version: 1, intent, input }),
	})
}

test('the v1 endpoint returns field issues for malformed contracts', async () => {
	const result = await action({
		request: mutationRequest('move-entry', {
			entryId: '',
			destinationWatchlistId: '',
			position: 0,
		}),
	} as any)

	expect(result.init?.status).toBe(400)
	expect(result.data).toEqual({
		ok: false,
		error: expect.objectContaining({
			code: 'INVALID_REQUEST',
			issues: expect.arrayContaining([
				expect.objectContaining({ path: 'input.entryId' }),
				expect.objectContaining({ path: 'input.destinationWatchlistId' }),
				expect.objectContaining({ path: 'input.position' }),
			]),
		}),
	})
})

test('the v1 endpoint rejects unsupported and oversized request bodies', async () => {
	const unsupported = await action({
		request: new Request(`${BASE_URL}/resources/lists/v1`, {
			method: 'POST',
			body: 'intent=move-entry',
		}),
	} as any)
	expect(unsupported.init?.status).toBe(415)
	expect(unsupported.data).toEqual({
		ok: false,
		error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
	})

	const oversized = await action({
		request: new Request(`${BASE_URL}/resources/lists/v1`, {
			method: 'POST',
			headers: {
				'content-length': '1000001',
				'content-type': 'application/json',
			},
			body: '{}',
		}),
	} as any)
	expect(oversized.init?.status).toBe(413)
	expect(oversized.data).toEqual({
		ok: false,
		error: expect.objectContaining({
			code: 'INVALID_REQUEST',
			message: 'List mutation payload is too large',
		}),
	})
})

test('the v1 endpoint translates authentication redirects into API errors', async () => {
	const { entry, destination } = await fixture()
	const result = await action({
		request: mutationRequest('move-entry', {
			entryId: entry.id,
			destinationWatchlistId: destination.id,
		}),
	} as any)

	expect(result.init?.status).toBe(401)
	expect(result.data).toEqual({
		ok: false,
		error: expect.objectContaining({ code: 'UNAUTHENTICATED' }),
	})
})

test('an owner can move and edit an entry through the versioned contract', async () => {
	const { entry, destination, cookie } = await fixture()

	const moved = await action({
		request: mutationRequest(
			'move-entry',
			{
				entryId: entry.id,
				destinationWatchlistId: destination.id,
				position: 1,
			},
			cookie,
		),
	} as any)
	expect(moved.data).toEqual({
		ok: true,
		data: expect.objectContaining({
			id: entry.id,
			watchlistId: destination.id,
		}),
	})

	const edited = await action({
		request: mutationRequest(
			'update-entry-cell',
			{
				entryId: entry.id,
				columnId: 'title',
				value: 'Typed resource endpoint',
			},
			cookie,
		),
	} as any)
	expect(edited.data).toEqual({
		ok: true,
		data: expect.objectContaining({
			id: entry.id,
			title: 'Typed resource endpoint',
		}),
	})

	const advancedEdited = await action({
		request: mutationRequest(
			'advanced-edit-entry',
			{
				entryId: entry.id,
				fields: { notes: 'Saved through the versioned JSON body' },
			},
			cookie,
		),
	} as any)
	expect(advancedEdited.data).toEqual({
		ok: true,
		data: expect.objectContaining({
			id: entry.id,
			notes: 'Saved through the versioned JSON body',
		}),
	})
})

test('ownership failures use a structured not-found response', async () => {
	const { entry, otherList, cookie } = await fixture()
	const result = await action({
		request: mutationRequest(
			'move-entry',
			{
				entryId: entry.id,
				destinationWatchlistId: otherList.id,
			},
			cookie,
		),
	} as any)

	expect(result.init?.status).toBe(404)
	expect(result.data).toEqual({
		ok: false,
		error: expect.objectContaining({ code: 'NOT_FOUND' }),
	})
})

test('the v1 entries resource returns a consistently ordered envelope', async () => {
	const { source } = await fixture()
	const result = await entriesLoader({
		request: new Request(
			`${BASE_URL}/resources/lists/v1/entries?watchlistId=${source.id}`,
		),
	} as any)

	expect(result.data).toEqual({
		ok: true,
		data: [
			expect.objectContaining({
				title: 'Versioned mutation fixture',
				position: 1,
				watchlistId: source.id,
			}),
		],
	})
	expect(new Headers(result.init?.headers).get('cache-control')).toBe(
		'private, no-store',
	)
})
