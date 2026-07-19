import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$collectionId.edit.tsx'
import {
	action as detailAction,
	loader as detailLoader,
} from './$collectionId.tsx'
import { loader as indexLoader } from './index.tsx'
import { action as newAction } from './new.tsx'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

function postRequest(
	path: string,
	values: Record<string, string>,
	cookie?: string,
) {
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			...(cookie ? { cookie } : {}),
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(values),
	})
}

test('collection creation validates input and preserves public/private metadata', async () => {
	const owner = await createUser('collection_owner')
	const cookie = await cookieFor(owner.id)
	const invalid = await newAction({
		request: postRequest('/collections/new', { title: '   ' }, cookie),
		params: {},
	} as any)
	if (invalid instanceof Response) throw new Error('Expected validation data')
	expect(invalid.init?.status).toBe(400)
	expect(invalid.data.errors.title?.[0]).toBeTruthy()

	const response = await newAction({
		request: postRequest(
			'/collections/new',
			{
				title: '  Essential Space Operas  ',
				description: '  A personal ranked list.  ',
			},
			cookie,
		),
		params: {},
	} as any)
	if (!(response instanceof Response)) throw new Error('Expected redirect')
	expect(response.status).toBe(303)
	const collection = await prisma.mediaCollection.findFirstOrThrow({
		where: { ownerId: owner.id },
	})
	expect(collection).toMatchObject({
		title: 'Essential Space Operas',
		description: 'A personal ranked list.',
		isPublic: false,
	})
	expect(response.headers.get('location')).toBe(`/collections/${collection.id}`)
})

test('private collections are owner-only while public collections are discoverable', async () => {
	const [owner, other] = await Promise.all([
		createUser('private_owner'),
		createUser('private_other'),
	])
	const collection = await prisma.mediaCollection.create({
		data: { ownerId: owner.id, title: 'Hidden Gems', isPublic: false },
	})
	const [ownerCookie, otherCookie] = await Promise.all([
		cookieFor(owner.id),
		cookieFor(other.id),
	])

	for (const request of [
		new Request(`${BASE_URL}/collections/${collection.id}`),
		new Request(`${BASE_URL}/collections/${collection.id}`, {
			headers: { cookie: otherCookie },
		}),
	]) {
		const denied = await detailLoader({
			request,
			params: { collectionId: collection.id },
		} as any).catch(error => error)
		expect(denied).toBeInstanceOf(Response)
		expect((denied as Response).status).toBe(404)
	}

	const ownerView = await detailLoader({
		request: new Request(`${BASE_URL}/collections/${collection.id}`, {
			headers: { cookie: ownerCookie },
		}),
		params: { collectionId: collection.id },
	} as any)
	expect(ownerView.data.isOwner).toBe(true)

	const anonymousIndex = await indexLoader({
		request: new Request(`${BASE_URL}/collections`),
		params: {},
	} as any)
	expect(anonymousIndex.data.collections).toHaveLength(0)
	const ownerIndex = await indexLoader({
		request: new Request(`${BASE_URL}/collections`, {
			headers: { cookie: ownerCookie },
		}),
		params: {},
	} as any)
	expect(ownerIndex.data.collections.map(item => item.id)).toContain(
		collection.id,
	)

	await editAction({
		request: postRequest(
			`/collections/${collection.id}/edit`,
			{
				intent: 'save',
				title: collection.title,
				description: '',
				isPublic: 'on',
			},
			ownerCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	const publicView = await detailLoader({
		request: new Request(`${BASE_URL}/collections/${collection.id}`),
		params: { collectionId: collection.id },
	} as any)
	expect(publicView.data.collection.id).toBe(collection.id)
})

test('owners can add, reorder, and remove canonical media without duplicates', async () => {
	const [owner, other] = await Promise.all([
		createUser('ordered_owner'),
		createUser('ordered_other'),
	])
	const [ownerCookie, otherCookie] = await Promise.all([
		cookieFor(owner.id),
		cookieFor(other.id),
	])
	const collection = await prisma.mediaCollection.create({
		data: { ownerId: owner.id, title: 'Ranked science fiction' },
	})
	const [first, second] = await Promise.all([
		prisma.media.create({ data: { kind: 'movie', title: 'Arrival' } }),
		prisma.media.create({ data: { kind: 'movie', title: 'Moon' } }),
	])

	for (const media of [first, second, first]) {
		await detailAction({
			request: postRequest(
				`/collections/${collection.id}`,
				{ intent: 'add-item', mediaId: media.id },
				ownerCookie,
			),
			params: { collectionId: collection.id },
		} as any)
	}
	let items = await prisma.mediaCollectionItem.findMany({
		where: { collectionId: collection.id },
		orderBy: { position: 'asc' },
	})
	expect(items).toHaveLength(2)
	expect(items.map(item => item.mediaId)).toEqual([first.id, second.id])

	const denied = await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'remove-item', itemId: items[0]!.id },
			otherCookie,
		),
		params: { collectionId: collection.id },
	} as any).catch(error => error)
	expect(denied).toBeInstanceOf(Response)
	expect((denied as Response).status).toBe(404)

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'move-item', itemId: items[1]!.id, direction: 'up' },
			ownerCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	items = await prisma.mediaCollectionItem.findMany({
		where: { collectionId: collection.id },
		orderBy: { position: 'asc' },
	})
	expect(items.map(item => item.mediaId)).toEqual([second.id, first.id])

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'remove-item', itemId: items[0]!.id },
			ownerCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	expect(
		await prisma.mediaCollectionItem.findMany({
			where: { collectionId: collection.id },
		}),
	).toEqual([expect.objectContaining({ mediaId: first.id, position: 1 })])
})
