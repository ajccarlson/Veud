import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader as watchlistLoader } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist.tsx'
import { loader as listTypeLoader } from '#app/routes/lists+/.$username+/.$list-type+/index.tsx'
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
	expect(publicLanding.data.watchListData[0]).toMatchObject({
		entryCount: 1,
		listEntries: [expect.objectContaining({ title: 'Public title' })],
	})
	const ownerLanding = await listTypeLoader(landingArgs(ownerCookie))
	expect(
		ownerLanding.data.watchListData.map(item => item.watchlist.id).sort(),
	).toEqual([privateList.id, publicList.id].sort())
	expect(
		ownerLanding.data.watchListData.map(item => [
			item.watchlist.id,
			item.entryCount,
		]),
	).toEqual(
		expect.arrayContaining([
			[publicList.id, 1],
			[privateList.id, 1],
		]),
	)

	const entryArgs = (watchlistId: string, cookie?: string) => {
		const request = new Request(
			`${BASE_URL}/resources/lists/v1/entries?watchlistId=${watchlistId}`,
			{
				headers: cookie ? { cookie } : undefined,
			},
		)
		return { request, url: new URL(request.url), params: {} } as any
	}
	const publicEntries = await v1EntryLoader(entryArgs(publicList.id))
	expect(publicEntries.data.ok).toBe(true)
	if (!publicEntries.data.ok) throw new Error('Expected public list entries')
	expect(publicEntries.data.data.map(entry => entry.title)).toEqual([
		'Public title',
	])
	const deniedEntries = await v1EntryLoader(
		entryArgs(privateList.id, otherCookie),
	)
	expect(deniedEntries.init?.status).toBe(404)
	expect(deniedEntries.data.ok).toBe(false)
	const privateEntries = await v1EntryLoader(
		entryArgs(privateList.id, ownerCookie),
	)
	expect(privateEntries.data.ok).toBe(true)
	if (!privateEntries.data.ok) throw new Error('Expected private list entries')
	expect(privateEntries.data.data.map(entry => entry.title)).toEqual([
		'Private title',
	])

	await prisma.entry.createMany({
		data: Array.from({ length: 6 }, (_, index) => ({
			watchlistId: publicList.id,
			position: index + 2,
			title: `Additional public title ${index + 1}`,
			type: 'TV Series',
		})),
	})
	const boundedLanding = await listTypeLoader(landingArgs())
	const boundedPublicList = boundedLanding.data.watchListData.find(
		item => item.watchlist.id === publicList.id,
	)
	expect(boundedPublicList).toMatchObject({ entryCount: 7 })
	expect(boundedPublicList?.listEntries).toHaveLength(5)
	expect(boundedPublicList?.listEntries.map(entry => entry.position)).toEqual([
		1, 2, 3, 4, 5,
	])
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
		media: { tmdbScore: 8.4 },
	})
	expect(entry).not.toHaveProperty('trackingState')
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

test('public list DTO exposes only configured tracking fields', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const owner = await prisma.user.create({
		data: {
			email: `dto_${suffix}@example.com`,
			username: `dto_${suffix}`,
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `dto-${suffix}`,
			header: 'DTO fixtures',
			columns:
				'{"title":"string","personal":"number","started":"date","finished":"date","length":"string"}',
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
			displayedColumns: 'title',
			isPublic: true,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'DTO title' },
	})
	const startedAt = new Date('2026-06-01T00:00:00.000Z')
	const state = await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			statusWatchlistId: watchlist.id,
			status: 'watching',
			score: 9.5,
			startedAt,
			completedAt: new Date('2026-06-20T00:00:00.000Z'),
			repeatCount: 4,
			progress: {
				create: { unit: 'episode', current: 10, total: 12 },
			},
		},
	})
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watchlist.id,
			mediaId: media.id,
			trackingStateId: state.id,
			position: 1,
			title: 'DTO title',
			personal: 8,
			length: '10 / 12 eps',
			history: JSON.stringify({
				started: '2025-01-01T00:00:00.000Z',
				finished: '2025-01-10T00:00:00.000Z',
				progress: { private: true },
				privateNote: 'never serialize this',
			}),
		},
	})

	const loadSurfaces = async () => {
		const detail = await watchlistLoader({
			request: new Request(
				`${BASE_URL}/lists/${owner.username}/${listType.name}/${watchlist.name}`,
			),
			params: {
				username: owner.username,
				'list-type': listType.name,
				watchlist: watchlist.name,
			},
		} as any)
		const v1Request = new Request(
			`${BASE_URL}/resources/lists/v1/entries?watchlistId=${watchlist.id}`,
		)
		const v1 = await v1EntryLoader({
			request: v1Request,
			url: new URL(v1Request.url),
			params: {},
		} as any)
		expect(v1.data.ok).toBe(true)
		if (!v1.data.ok) throw new Error('Expected a public list response')
		return [detail.data.listEntries, v1.data.data]
	}

	for (const entries of await loadSurfaces()) {
		expect(entries[0]).toMatchObject({ title: 'DTO title' })
		for (const field of ['personal', 'length', 'history', 'trackingState']) {
			expect(entries[0]).not.toHaveProperty(field)
		}
	}

	await prisma.watchlist.update({
		where: { id: watchlist.id },
		data: { displayedColumns: 'title, started' },
	})
	for (const entries of await loadSurfaces()) {
		expect(entries[0]).not.toHaveProperty('personal')
		expect(entries[0]).not.toHaveProperty('trackingState')
		expect(JSON.parse(String(entries[0]?.history))).toEqual({
			started: startedAt.toISOString(),
		})
		expect(String(entries[0]?.history)).not.toContain('privateNote')
		expect(String(entries[0]?.history)).not.toContain('progress')
		expect(String(entries[0]?.history)).not.toContain('finished')
	}

	await prisma.trackingState.update({
		where: { id: state.id },
		data: { startedAt: null },
	})
	await prisma.entry.update({
		where: { id: entry.id },
		data: {
			history: JSON.stringify({
				started: { privateNote: 'never serialize a structured date value' },
			}),
		},
	})
	for (const entries of await loadSurfaces()) {
		expect(JSON.parse(String(entries[0]?.history))).toEqual({ started: null })
		expect(String(entries[0]?.history)).not.toContain('privateNote')
	}

	await prisma.entry.update({
		where: { id: entry.id },
		data: {
			history: JSON.stringify({
				started: '2026-01-01T00:00:00.000Z',
				padding: 'private'.repeat(10_000),
			}),
		},
	})
	for (const entries of await loadSurfaces()) {
		expect(JSON.parse(String(entries[0]?.history))).toEqual({ started: null })
		expect(String(entries[0]?.history)).not.toContain('private')
	}
})

test('public duplicate entries cannot expose private or invalid tracking state', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const [owner, other] = await Promise.all([
		prisma.user.create({
			data: {
				email: `state_owner_${suffix}@example.com`,
				username: `state_owner_${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `state_other_${suffix}@example.com`,
				username: `state_other_${suffix}`,
			},
		}),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `state-privacy-${suffix}`,
			header: 'State privacy fixtures',
			columns: JSON.stringify({
				title: 'string',
				personal: 'number',
				differencePersonal: 'number',
				differenceObjective: 'number',
				started: 'date',
				length: 'number',
				chapters: 'number',
				volumes: 'number',
			}),
			mediaType: '["episode","chapter","volume"]',
			completionType: '{"present":"watching"}',
		},
	})
	const [publicList, privateList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'public',
				header: 'Public',
				position: 1,
				displayedColumns:
					'title, personal, differencePersonal, differenceObjective, started, length, chapters, volumes',
				isPublic: true,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'private',
				header: 'Private',
				position: 2,
				isPublic: false,
			},
		}),
	])
	const [hiddenMedia, publicMedia, crossOwnerMedia, stateMedia, entryMedia] =
		await Promise.all(
			[
				'Hidden canonical title',
				'Visible canonical title',
				'Cross-owner title',
				'Mismatched state title',
				'Mismatched entry title',
			].map(title =>
				prisma.media.create({
					data: { kind: 'tv', title },
				}),
			),
		)
	const [hiddenState, publicState, crossOwnerState, mismatchedState] =
		await Promise.all([
			prisma.trackingState.create({
				data: {
					ownerId: owner.id,
					mediaId: hiddenMedia.id,
					statusWatchlistId: privateList.id,
					status: 'watching',
					score: 9.75,
					progress: {
						create: [
							{ unit: 'episode', current: 11, total: 24 },
							{ unit: 'chapter', current: 12, total: 40 },
							{ unit: 'volume', current: 3, total: 10 },
							{ unit: 'minute', current: 90, total: 120 },
						],
					},
				},
			}),
			prisma.trackingState.create({
				data: {
					ownerId: owner.id,
					mediaId: publicMedia.id,
					statusWatchlistId: publicList.id,
					status: 'watching',
					score: 7.25,
				},
			}),
			prisma.trackingState.create({
				data: {
					ownerId: other.id,
					mediaId: crossOwnerMedia.id,
					status: 'watching',
					score: 8.5,
				},
			}),
			prisma.trackingState.create({
				data: {
					ownerId: owner.id,
					mediaId: stateMedia.id,
					statusWatchlistId: publicList.id,
					status: 'watching',
					score: 8.75,
				},
			}),
		])
	const canonicalThumbnail =
		'https://image.tmdb.org/t/p/original/canonical-privacy.jpg'
	const [, linkedFavorite] = await Promise.all([
		prisma.media.update({
			where: { id: publicMedia.id },
			data: {
				thumbnail: canonicalThumbnail,
				externalIds: {
					create: {
						provider: 'tmdb',
						kind: 'tv',
						externalId: `privacy-${suffix}`,
					},
				},
			},
		}),
		prisma.userFavorite.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				mediaId: publicMedia.id,
				position: 1,
				title: 'Private favorite snapshot',
				thumbnail: 'https://member.example/private-favorite.jpg',
				mediaType: 'Private favorite type',
				startYear: '2099',
			},
		}),
	])
	await prisma.entry.create({
		data: {
			watchlistId: privateList.id,
			mediaId: hiddenMedia.id,
			trackingStateId: hiddenState.id,
			position: 1,
			title: 'Private canonical entry',
			personal: 9.75,
			history: '{"finished":"private canonical history"}',
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: publicList.id,
				mediaId: hiddenMedia.id,
				trackingStateId: hiddenState.id,
				position: 1,
				title: 'Public duplicate',
				personal: 8.25,
				differencePersonal: 6.5,
				differenceObjective: 5.5,
				history: '{"finished":"private mirrored history"}',
				length: '11',
				chapters: '12',
				volumes: '3',
			},
			{
				watchlistId: publicList.id,
				mediaId: publicMedia.id,
				trackingStateId: publicState.id,
				position: 2,
				title: 'Visible state',
				personal: 7,
			},
			{
				watchlistId: publicList.id,
				mediaId: crossOwnerMedia.id,
				trackingStateId: crossOwnerState.id,
				position: 3,
				title: 'Cross-owner state',
				personal: 8,
				history: '{"finished":"cross-owner history"}',
			},
			{
				watchlistId: publicList.id,
				mediaId: entryMedia.id,
				trackingStateId: mismatchedState.id,
				position: 4,
				title: 'Mismatched state',
				personal: 8,
				history: '{"finished":"mismatched history"}',
			},
		],
	})

	const [ownerCookie, otherCookie] = await Promise.all([
		sessionCookie(owner.id),
		sessionCookie(other.id),
	])
	const headers = (cookie?: string) => (cookie ? { cookie } : undefined)
	const loadSurfaces = async (cookie?: string) => {
		const detail = await watchlistLoader({
			request: new Request(
				`${BASE_URL}/lists/${owner.username}/${listType.name}/${publicList.name}`,
				{ headers: headers(cookie) },
			),
			params: {
				username: owner.username,
				'list-type': listType.name,
				watchlist: publicList.name,
			},
		} as any)
		const v1Request = new Request(
			`${BASE_URL}/resources/lists/v1/entries?watchlistId=${publicList.id}`,
			{ headers: headers(cookie) },
		)
		const v1 = await v1EntryLoader({
			request: v1Request,
			url: new URL(v1Request.url),
			params: {},
		} as any)
		expect(v1.data.ok).toBe(true)
		if (!v1.data.ok) throw new Error('Expected the public v1 list response')
		const landing = await listTypeLoader({
			request: new Request(
				`${BASE_URL}/lists/${owner.username}/${listType.name}`,
				{ headers: headers(cookie) },
			),
			params: {
				username: owner.username,
				'list-type': listType.name,
			},
		} as any)
		const landingEntries =
			landing.data.watchListData.find(
				item => item.watchlist.id === publicList.id,
			)?.listEntries ?? []
		return {
			entries: {
				detail: detail.data.listEntries,
				v1: v1.data.data,
			},
			landingEntries,
			typedFavorites: detail.data.typedFavorites,
		}
	}

	const expectVisitorPrivacy = (entries: Array<Record<string, unknown>>) => {
		for (const [position, canonicalTitle] of [
			[1, 'Hidden canonical title'],
			[3, 'Cross-owner title'],
			[4, 'Mismatched entry title'],
		] as const) {
			const hidden = entries.find(entry => entry.position === position)
			expect(hidden).toMatchObject({
				title: canonicalTitle,
				personal: null,
				differencePersonal: null,
				differenceObjective: null,
				length: null,
				chapters: null,
				volumes: null,
			})
			expect(hidden).not.toHaveProperty('trackingState')
			expect(JSON.parse(String(hidden?.history))).toEqual({ started: null })
		}
		const visible = entries.find(entry => entry.position === 2)
		expect(visible).toMatchObject({
			title: 'Visible canonical title',
			personal: 7.25,
		})
		expect(visible).not.toHaveProperty('trackingState')
		expect(JSON.parse(String(visible?.history))).toEqual({ started: null })
		expect(entries.map(entry => entry.title)).not.toEqual(
			expect.arrayContaining([
				'Public duplicate',
				'Visible state',
				'Cross-owner state',
				'Mismatched state',
			]),
		)
	}

	for (const cookie of [undefined, otherCookie]) {
		const result = await loadSurfaces(cookie)
		for (const entries of Object.values(result.entries)) {
			expectVisitorPrivacy(entries as Array<Record<string, unknown>>)
		}
		expect(
			result.landingEntries.map((entry: { title: string }) => entry.title),
		).toEqual([
			'Hidden canonical title',
			'Visible canonical title',
			'Cross-owner title',
			'Mismatched entry title',
		])
		expect(result.landingEntries[1]).toMatchObject({
			thumbnail: canonicalThumbnail,
		})
		expect(result.typedFavorites).toEqual({})
		expect(
			result.entries.detail.find(entry => entry.position === 2)?.media,
		).toMatchObject({
			kind: 'tv',
			externalIds: [
				{
					provider: 'tmdb',
					kind: 'tv',
					externalId: `privacy-${suffix}`,
				},
			],
		})
	}

	const ownerResult = await loadSurfaces(ownerCookie)
	for (const entries of Object.values(ownerResult.entries)) {
		expect(entries.find(entry => entry.position === 1)).toMatchObject({
			title: 'Hidden canonical title',
			personal: 9.75,
			differencePersonal: 6.5,
			differenceObjective: 5.5,
			history: '{"finished":"private mirrored history"}',
			length: '11',
			chapters: '12',
			volumes: '3',
			trackingState: { score: 9.75 },
		})
		for (const [position, canonicalTitle] of [
			[3, 'Cross-owner title'],
			[4, 'Mismatched entry title'],
		] as const) {
			expect(entries.find(entry => entry.position === position)).toMatchObject({
				title: canonicalTitle,
				personal: null,
				history: null,
				trackingState: null,
			})
		}
		expect(entries.map(entry => entry.title)).not.toEqual(
			expect.arrayContaining([
				'Public duplicate',
				'Visible state',
				'Cross-owner state',
				'Mismatched state',
			]),
		)
	}
	expect(
		ownerResult.landingEntries.map((entry: { title: string }) => entry.title),
	).toEqual([
		'Hidden canonical title',
		'Visible canonical title',
		'Cross-owner title',
		'Mismatched entry title',
	])
	expect(ownerResult.typedFavorites).toEqual({
		[listType.id]: [
			{
				id: linkedFavorite.id,
				typeId: listType.id,
				thumbnail: canonicalThumbnail,
			},
		],
	})
	const ownerDetailState = ownerResult.entries.detail.find(
		entry => entry.position === 1,
	)?.trackingState
	expect(
		ownerResult.entries.detail.find(entry => entry.position === 2)?.media,
	).toMatchObject({
		kind: 'tv',
		externalIds: [
			{
				provider: 'tmdb',
				kind: 'tv',
				externalId: `privacy-${suffix}`,
			},
		],
	})
	for (const entries of [ownerResult.entries.v1]) {
		expect(entries.find(entry => entry.position === 2)?.media).toMatchObject({
			kind: 'tv',
			externalIds: [
				{
					provider: 'tmdb',
					kind: 'tv',
					externalId: `privacy-${suffix}`,
				},
			],
		})
	}
	const ownerDetailProgress = (
		ownerDetailState as { progress: Array<{ unit: string }> } | null | undefined
	)?.progress
	expect(ownerDetailProgress?.map(progress => progress.unit)).toEqual([
		'chapter',
		'episode',
		'volume',
	])
	expect(ownerDetailState).not.toHaveProperty('ownerId')
	expect(ownerDetailState).not.toHaveProperty('mediaId')
	expect(ownerDetailState).toHaveProperty('statusWatchlistId', privateList.id)
	expect(ownerDetailState).not.toHaveProperty('statusWatchlist')
})
