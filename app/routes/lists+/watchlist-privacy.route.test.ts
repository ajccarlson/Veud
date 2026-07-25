import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader as watchlistLoader } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist.tsx'
import { loader as listTypeLoader } from '#app/routes/lists+/.$username+/.$list-type+/index.tsx'
import { loader as entryLoader } from '#app/routes/lists+/.fetch+/get-list-entries.$request.ts'
import { loader as v1EntryLoader } from '#app/routes/resources+/lists.v1.entries.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function sessionCookie(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
		select: { id: true },
	})
	return getSessionCookieHeader(session)
}

async function expectNotFound(promise: Promise<unknown>) {
	const response = await promise.catch(error => error)
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(404)
}

test('private lists are owner-only across detail, landing, and entry loaders', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const [owner, other] = await Promise.all([
		prisma.user.create({
			data: {
				email: `owner_${suffix}@example.com`,
				username: `owner_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `other_${suffix}@example.com`,
				username: `other_${suffix}`,
			},
		}),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `privacy-${suffix}`,
			header: 'Privacy fixtures',
			columns: '{"title":"string","type":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
	})
	const [publicList, privateList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'public-list',
				header: 'Public list',
				position: 1,
				displayedColumns: 'title, type',
				isPublic: true,
				entries: {
					create: { position: 1, title: 'Public title', type: 'TV Series' },
				},
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'private-list',
				header: 'Private list',
				position: 2,
				displayedColumns: 'title, type',
				isPublic: false,
				entries: {
					create: { position: 1, title: 'Private title', type: 'TV Series' },
				},
			},
		}),
	])
	const [ownerCookie, otherCookie] = await Promise.all([
		sessionCookie(owner.id),
		sessionCookie(other.id),
	])
	const detailArgs = (watchlist: string, cookie?: string) =>
		({
			request: new Request(
				`${BASE_URL}/lists/${owner.username}/${listType.name}/${watchlist}`,
				{
					headers: cookie ? { cookie } : undefined,
				},
			),
			params: {
				username: owner.username,
				'list-type': listType.name,
				watchlist,
			},
		}) as any

	const publicResult = await watchlistLoader(detailArgs(publicList.name))
	expect(publicResult.data.listEntries.map(entry => entry.title)).toEqual([
		'Public title',
	])
	await expectNotFound(watchlistLoader(detailArgs(privateList.name)))
	await expectNotFound(
		watchlistLoader(detailArgs(privateList.name, otherCookie)),
	)
	const privateResult = await watchlistLoader(
		detailArgs(privateList.name, ownerCookie),
	)
	expect(privateResult.data.listEntries.map(entry => entry.title)).toEqual([
		'Private title',
	])

	const landingArgs = (cookie?: string) =>
		({
			request: new Request(
				`${BASE_URL}/lists/${owner.username}/${listType.name}`,
				{
					headers: cookie ? { cookie } : undefined,
				},
			),
			params: { username: owner.username, 'list-type': listType.name },
		}) as any
	const publicLanding = await listTypeLoader(landingArgs())
	expect(publicLanding.data.listOwner).toEqual({
		id: owner.id,
		username: owner.username,
	})
	expect(publicLanding.data.listOwner).not.toHaveProperty('email')
	expect(
		publicLanding.data.watchListData.map(item => item.watchlist.id),
	).toEqual([publicList.id])
	const ownerLanding = await listTypeLoader(landingArgs(ownerCookie))
	expect(
		ownerLanding.data.watchListData.map(item => item.watchlist.id).sort(),
	).toEqual([privateList.id, publicList.id].sort())

	const entryArgs = (watchlistId: string, cookie?: string) =>
		({
			request: new Request(BASE_URL, {
				headers: cookie ? { cookie } : undefined,
			}),
			params: {
				request: new URLSearchParams({ watchlistId }).toString(),
			},
		}) as any
	expect(
		(await entryLoader(entryArgs(publicList.id))).map(entry => entry.title),
	).toEqual(['Public title'])
	await expectNotFound(entryLoader(entryArgs(privateList.id, otherCookie)))
	expect(
		(await entryLoader(entryArgs(privateList.id, ownerCookie))).map(
			entry => entry.title,
		),
	).toEqual(['Private title'])
})

test('watchlist detail loader returns browser-safe canonical scores', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `scores_${suffix}@example.com`,
			username: `scores_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `scores-${suffix}`,
			header: 'Score fixtures',
			columns: '{"title":"string","personal":"number","tmdbScore":"number"}',
			mediaType: '["episode"]',
			completionType: '{"present":"watching"}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
			displayedColumns: 'title, personal, tmdbScore',
			isPublic: true,
		},
	})
	const media = await prisma.media.create({
		data: {
			kind: 'tv',
			title: 'Canonical scored title',
			tmdbScore: 8.4,
		},
	})
	const trackingState = await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			statusWatchlistId: watchlist.id,
			status: 'watching',
			score: 7.6,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			mediaId: media.id,
			trackingStateId: trackingState.id,
			position: 1,
			title: 'Canonical scored title',
			personal: 6.2,
			tmdbScore: 7.9,
		},
	})

	const result = await watchlistLoader({
		request: new Request(
			`${BASE_URL}/lists/${owner.username}/${listType.name}/${watchlist.name}`,
		),
		params: {
			username: owner.username,
			'list-type': listType.name,
			watchlist: watchlist.name,
		},
	} as any)
	const [entry] = result.data.listEntries

	expect(entry).toMatchObject({
		personal: 7.6,
		tmdbScore: 8.4,
		trackingState: { score: 7.6 },
		media: { tmdbScore: 8.4 },
	})
	expect(typeof entry.personal).toBe('number')
	expect(typeof entry.tmdbScore).toBe('number')
})

test('public watchlist payload excludes account data and hidden entry fields', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `private_${suffix}@example.com`,
			username: `private_${suffix}`,
			accountStatus: 'suspended',
			accountStatusReason: 'Must never cross the public loader boundary',
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `public-contract-${suffix}`,
			header: 'Public contract',
			columns:
				'{"title":"string","personal":"number","notes":"string","description":"string"}',
			mediaType: '["episode"]',
			completionType: '{"present":"watching"}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
			displayedColumns: 'title, personal',
			isPublic: true,
			entries: {
				create: {
					position: 1,
					title: 'Public title',
					personal: 8,
					notes: 'Hidden private note',
					description: 'Hidden description',
					history: '{"started":"2026-01-01"}',
				},
			},
		},
	})

	const result = await watchlistLoader({
		request: new Request(
			`${BASE_URL}/lists/${owner.username}/${listType.name}/${watchlist.name}`,
		),
		params: {
			username: owner.username,
			'list-type': listType.name,
			watchlist: watchlist.name,
		},
	} as any)

	expect(result.data.listOwner).toEqual({
		id: owner.id,
		username: owner.username,
	})
	expect(result.data.listOwner).not.toHaveProperty('email')
	expect(result.data.listOwner).not.toHaveProperty('accountStatus')
	expect(result.data.listEntries[0]).toMatchObject({
		title: 'Public title',
		personal: 8,
	})
	expect(result.data.listEntries[0]).not.toHaveProperty('notes')
	expect(result.data.listEntries[0]).not.toHaveProperty('description')
	expect(result.data.listEntries[0]).not.toHaveProperty('history')
	expect(result.data).not.toHaveProperty('watchLists')
	expect(result.data).not.toHaveProperty('watchListsSorted')

	const legacyEntries = await entryLoader({
		request: new Request(BASE_URL),
		params: {
			request: new URLSearchParams({ watchlistId: watchlist.id }).toString(),
		},
	} as any)
	expect(legacyEntries[0]).not.toHaveProperty('notes')
	expect(legacyEntries[0]).not.toHaveProperty('history')

	const v1Request = new Request(
		`${BASE_URL}/resources/lists/v1/entries?watchlistId=${watchlist.id}`,
	)
	const v1Entries = await v1EntryLoader({
		request: v1Request,
		url: new URL(v1Request.url),
		params: {},
	} as any)
	expect(v1Entries.data.ok).toBe(true)
	if (v1Entries.data.ok) {
		expect(v1Entries.data.data[0]).not.toHaveProperty('notes')
		expect(v1Entries.data.data[0]).not.toHaveProperty('history')
	}
})
