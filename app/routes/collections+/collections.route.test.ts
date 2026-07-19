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
	const tooManyTags = await newAction({
		request: postRequest(
			'/collections/new',
			{
				title: 'Too many tags',
				tags: 'one, two, three, four, five, six',
			},
			cookie,
		),
		params: {},
	} as any)
	if (tooManyTags instanceof Response)
		throw new Error('Expected validation data')
	expect(tooManyTags.init?.status).toBe(400)
	expect(tooManyTags.data.errors.tags?.[0]).toContain('no more than 5')

	const response = await newAction({
		request: postRequest(
			'/collections/new',
			{
				title: '  Essential Space Operas  ',
				description: '  A personal ranked list.  ',
				tags: ' Sci-Fi, Space Opera, sci-fi ',
			},
			cookie,
		),
		params: {},
	} as any)
	if (!(response instanceof Response)) throw new Error('Expected redirect')
	expect(response.status).toBe(303)
	const collection = await prisma.mediaCollection.findFirstOrThrow({
		where: { ownerId: owner.id },
		include: {
			tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
		},
	})
	expect(collection).toMatchObject({
		title: 'Essential Space Operas',
		description: 'A personal ranked list.',
		isPublic: false,
	})
	expect(collection.tags.map(({ tag }) => [tag.name, tag.slug])).toEqual([
		['sci-fi', 'sci-fi'],
		['space opera', 'space-opera'],
	])
	expect(response.headers.get('location')).toBe(`/collections/${collection.id}`)

	await editAction({
		request: postRequest(
			`/collections/${collection.id}/edit`,
			{
				intent: 'save',
				title: collection.title,
				description: collection.description ?? '',
				tags: 'classics, Space Opera',
			},
			cookie,
		),
		params: { collectionId: collection.id },
	} as any)
	expect(
		await prisma.mediaCollectionTag.findMany({
			where: { collectionId: collection.id },
			orderBy: { tag: { name: 'asc' } },
			select: { tag: { select: { name: true, slug: true } } },
		}),
	).toEqual([
		{ tag: { name: 'classics', slug: 'classics' } },
		{ tag: { name: 'space opera', slug: 'space-opera' } },
	])
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

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{
				intent: 'note-item',
				itemId: items[0]!.id,
				note: '  The emotional anchor of the list.  ',
			},
			ownerCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	expect(
		await prisma.mediaCollectionItem.findUnique({
			where: { id: items[0]!.id },
			select: { note: true },
		}),
	).toEqual({ note: 'The emotional anchor of the list.' })
	const deniedNote = await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'note-item', itemId: items[0]!.id, note: 'Hijacked note' },
			otherCookie,
		),
		params: { collectionId: collection.id },
	} as any).catch(error => error)
	expect(deniedNote).toBeInstanceOf(Response)
	expect((deniedNote as Response).status).toBe(404)

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

test('members can like and discuss public collections with source-linked notifications', async () => {
	const [owner, member, unrelated] = await Promise.all([
		createUser('engagement_owner'),
		createUser('engagement_member'),
		createUser('engagement_unrelated'),
	])
	const [ownerCookie, memberCookie, unrelatedCookie] = await Promise.all([
		cookieFor(owner.id),
		cookieFor(member.id),
		cookieFor(unrelated.id),
	])
	const collection = await prisma.mediaCollection.create({
		data: { ownerId: owner.id, title: 'Shared discoveries', isPublic: true },
	})

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'like-toggle' },
			memberCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	const like = await prisma.collectionLike.findUniqueOrThrow({
		where: {
			userId_collectionId: { userId: member.id, collectionId: collection.id },
		},
	})
	expect(
		await prisma.notification.findUnique({
			where: { collectionLikeId: like.id },
		}),
	).toEqual(
		expect.objectContaining({
			type: 'collection_like',
			recipientId: owner.id,
			actorId: member.id,
			collectionId: collection.id,
		}),
	)

	const likedView = await detailLoader({
		request: new Request(`${BASE_URL}/collections/${collection.id}`, {
			headers: { cookie: memberCookie },
		}),
		params: { collectionId: collection.id },
	} as any)
	expect(likedView.data.viewerLiked).toBe(true)
	expect(likedView.data.collection._count.likes).toBe(1)

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'like-toggle' },
			memberCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	expect(
		await prisma.collectionLike.count({
			where: { collectionId: collection.id },
		}),
	).toBe(0)
	expect(
		await prisma.notification.count({
			where: { collectionLikeId: like.id },
		}),
	).toBe(0)

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'comment-create', body: '  This list has range.  ' },
			memberCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	const comment = await prisma.collectionComment.findFirstOrThrow({
		where: { collectionId: collection.id, authorId: member.id },
	})
	expect(comment.body).toBe('This list has range.')
	expect(
		await prisma.notification.findUnique({
			where: { collectionCommentId: comment.id },
		}),
	).toEqual(
		expect.objectContaining({
			type: 'collection_comment',
			recipientId: owner.id,
			actorId: member.id,
			collectionId: collection.id,
		}),
	)

	const denied = await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'comment-delete', commentId: comment.id },
			unrelatedCookie,
		),
		params: { collectionId: collection.id },
	} as any).catch(error => error)
	expect(denied).toBeInstanceOf(Response)
	expect((denied as Response).status).toBe(404)

	await detailAction({
		request: postRequest(
			`/collections/${collection.id}`,
			{ intent: 'comment-delete', commentId: comment.id },
			ownerCookie,
		),
		params: { collectionId: collection.id },
	} as any)
	expect(
		await prisma.collectionComment.findUnique({ where: { id: comment.id } }),
	).toBeNull()
	expect(
		await prisma.notification.count({
			where: { collectionCommentId: comment.id },
		}),
	).toBe(0)
})

test('members can clone a public collection into a private editable copy', async () => {
	const [owner, member] = await Promise.all([
		createUser('clone_owner'),
		createUser('clone_member'),
	])
	const memberCookie = await cookieFor(member.id)
	const [first, second] = await Promise.all([
		prisma.media.create({ data: { kind: 'movie', title: 'First clone item' } }),
		prisma.media.create({
			data: { kind: 'movie', title: 'Second clone item' },
		}),
	])
	const source = await prisma.mediaCollection.create({
		data: {
			ownerId: owner.id,
			title: 'Clone-worthy cinema',
			description: 'Keep the curator context.',
			isPublic: true,
			items: {
				create: [
					{
						mediaId: first.id,
						position: 2,
						note: 'A patient finale.',
					},
					{
						mediaId: second.id,
						position: 1,
						note: 'The ideal opener.',
					},
				],
			},
			tags: {
				create: {
					tag: { create: { name: 'science fiction', slug: 'science-fiction' } },
				},
			},
		},
	})

	const response = await detailAction({
		request: postRequest(
			`/collections/${source.id}`,
			{ intent: 'clone' },
			memberCookie,
		),
		params: { collectionId: source.id },
	} as any)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(303)
	const cloneId = (response as Response).headers
		.get('location')
		?.split('/')
		.at(-1)
	expect(cloneId).toBeTruthy()

	const clone = await prisma.mediaCollection.findUniqueOrThrow({
		where: { id: cloneId },
		include: {
			items: { orderBy: { position: 'asc' } },
			tags: { include: { tag: true } },
		},
	})
	expect(clone).toMatchObject({
		ownerId: member.id,
		title: 'Clone-worthy cinema (copy)',
		description: 'Keep the curator context.',
		isPublic: false,
	})
	expect(clone.items.map(item => item.mediaId)).toEqual([second.id, first.id])
	expect(clone.items.map(item => item.note)).toEqual([
		'The ideal opener.',
		'A patient finale.',
	])
	expect(clone.tags.map(({ tag }) => tag.slug)).toEqual(['science-fiction'])
})

test('community collections can be sorted by like count', async () => {
	const [owner, firstVoter, secondVoter] = await Promise.all([
		createUser('popular_owner'),
		createUser('popular_voter_one'),
		createUser('popular_voter_two'),
	])
	const [lessPopular, morePopular] = await Promise.all([
		prisma.mediaCollection.create({
			data: { ownerId: owner.id, title: 'One vote', isPublic: true },
		}),
		prisma.mediaCollection.create({
			data: {
				ownerId: owner.id,
				title: 'Two votes',
				isPublic: true,
				tags: {
					create: {
						tag: { create: { name: 'mind bending', slug: 'mind-bending' } },
					},
				},
			},
		}),
	])
	await prisma.collectionLike.createMany({
		data: [
			{ userId: firstVoter.id, collectionId: lessPopular.id },
			{ userId: firstVoter.id, collectionId: morePopular.id },
			{ userId: secondVoter.id, collectionId: morePopular.id },
		],
	})

	const result = await indexLoader({
		request: new Request(`${BASE_URL}/collections?sort=popular`),
		params: {},
	} as any)
	expect(result.data.sort).toBe('popular')
	expect(result.data.collections.map(collection => collection.id)).toEqual([
		morePopular.id,
		lessPopular.id,
	])
	expect(result.data.collections[0]?._count.likes).toBe(2)

	const tagged = await indexLoader({
		request: new Request(`${BASE_URL}/collections?tag=Mind%20Bending`),
		params: {},
	} as any)
	expect(tagged.data.activeTag).toEqual({
		name: 'mind bending',
		slug: 'mind-bending',
	})
	expect(tagged.data.collections.map(collection => collection.id)).toEqual([
		morePopular.id,
	])
	expect(tagged.data.availableTags).toContainEqual({
		name: 'mind bending',
		slug: 'mind-bending',
	})
})
