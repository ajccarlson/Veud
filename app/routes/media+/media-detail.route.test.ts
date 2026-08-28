import { faker } from '@faker-js/faker'
import { type Prisma } from '@prisma/client'
import { expect, test, vi } from 'vitest'
import {
	action,
	loader,
	MEDIA_DETAIL_COLLECTION_LIMIT,
} from '#app/routes/media+/$mediaId.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import {
	applyCatalogMediaMerge,
	prepareCatalogMediaMerge,
} from '#app/utils/catalog-media-merge.server.ts'
import { expectedCatalogMergeConfirmation } from '#app/utils/catalog-media-merge.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'

async function user(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

async function fixture() {
	const [catalogOwner, tracker, otherUser] = await Promise.all([
		user('catalog'),
		user('tracker'),
		user('other'),
	])
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{"length":"string"}',
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
	})
	const [catalogList, watching, completed, otherList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				ownerId: catalogOwner.id,
				typeId: listType.id,
				isPublic: false,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				position: 1,
				ownerId: tracker.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'completed',
				header: 'Completed',
				position: 2,
				ownerId: tracker.id,
				typeId: listType.id,
			},
		}),
		prisma.watchlist.create({
			data: {
				name: 'watching',
				header: 'Watching',
				ownerId: otherUser.id,
				typeId: listType.id,
			},
		}),
	])
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			catalogProvenanceVersion: 1,
			title: 'Fullmetal Alchemist: Brotherhood',
			type: 'TV',
			thumbnail:
				'https://example.com/fmab.jpg|https://myanimelist.net/anime/5114',
			length: '12 eps',
			episodeCount: 12,
			runtimeMinutes: 24,
			originalTitle: '鋼の錬金術師 FULLMETAL ALCHEMIST',
			language: 'Japanese',
			rating: 'PG-13',
			studios: JSON.stringify([
				'Bones|https://myanimelist.net/anime/producer/4',
			]),
			videos: JSON.stringify([
				{
					provider: 'tmdb',
					site: 'youtube',
					key: 'trailer_5114',
					name: 'Official trailer',
					type: 'Trailer',
					official: true,
					publishedAt: null,
				},
			]),
			startSeason: 'Fall 2009',
			description: 'Two brothers search for the Philosopher’s Stone.',
			externalIds: {
				create: { provider: 'mal', kind: 'anime', externalId: '5114' },
			},
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: catalogList.id,
			mediaId: media.id,
			position: 1,
			title: 'Outdated user snapshot',
			type: 'TV',
			thumbnail:
				'https://example.com/old.jpg|https://myanimelist.net/anime/5114',
			length: '24 eps',
			description: 'An outdated per-user snapshot.',
		},
	})
	const session = await prisma.session.create({
		data: {
			userId: tracker.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)
	return {
		media,
		tracker,
		otherUser,
		watching,
		completed,
		otherList,
		cookie,
	}
}

function actionRequest(
	mediaId: string,
	cookie: string,
	data: Record<string, string>,
) {
	return new Request(`${BASE_URL}/media/${mediaId}`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(data),
	})
}

async function cookieFor(userId: string) {
	const session = await prisma.session.create({
		data: { userId, expirationDate: getSessionExpirationDate() },
	})
	return getSessionCookieHeader(session)
}

test('public media loader prefers canonical catalog over legacy entry snapshots', async () => {
	const { media } = await fixture()
	const result = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`),
		params: { mediaId: media.id },
	} as any)

	expect(result.data.media).toEqual(
		expect.objectContaining({
			id: media.id,
			kind: 'anime',
			title: 'Fullmetal Alchemist: Brotherhood',
			imageUrl: 'https://example.com/fmab.jpg',
		}),
	)
	expect(result.data.media.externalLinks).toEqual([
		expect.objectContaining({
			provider: 'mal',
			url: 'https://myanimelist.net/anime/5114',
		}),
	])
	expect(result.data.media.facts).toEqual(
		expect.arrayContaining([
			{ label: 'Original title', value: '鋼の錬金術師 FULLMETAL ALCHEMIST' },
			{ label: 'Runtime', value: '24m per episode' },
			{ label: 'Studios', value: 'Bones' },
		]),
	)
	expect(result.data.media.videos).toEqual([
		expect.objectContaining({
			name: 'Official trailer',
			url: 'https://www.youtube.com/watch?v=trailer_5114',
			thumbnailUrl: 'https://i.ytimg.com/vi/trailer_5114/hqdefault.jpg',
		}),
	])
	expect(result.data.community).toMatchObject({
		trackers: 0,
		ratings: 0,
		meanScore: null,
		reviews: 0,
		diaryEntries: 0,
		favorites: 0,
	})
	expect(result.data.community.statusBreakdown).toEqual([])
	expect(
		result.data.community.scoreDistribution.every(bucket => bucket.count === 0),
	).toBe(true)
	expect(result.data.socialContext).toBeNull()
	expect(result.data.viewer).toBeNull()
})

test('anonymous sparse media never reads or exposes private entry metadata', async () => {
	const { media } = await fixture()
	const privateMetadata = {
		title: 'PRIVATE ENTRY TITLE MUST NOT ESCAPE',
		description: 'PRIVATE ENTRY DESCRIPTION MUST NOT ESCAPE',
		thumbnail: 'https://private.example/entry-cover.jpg',
	}
	await Promise.all([
		prisma.media.update({
			where: { id: media.id },
			data: { title: null, description: null, thumbnail: null },
		}),
		prisma.entry.updateMany({
			where: { mediaId: media.id },
			data: privateMetadata,
		}),
	])
	const queryRaw = vi.spyOn(prisma, '$queryRaw')

	try {
		const result = await loader({
			request: new Request(`${BASE_URL}/media/${media.id}`),
			params: { mediaId: media.id },
		} as any)

		expect(
			queryRaw.mock.calls.filter(([query]) =>
				(query as Prisma.Sql).sql?.includes('FROM "Entry"'),
			),
		).toHaveLength(0)
		expect(result.data.media).toEqual(
			expect.objectContaining({
				id: media.id,
				title: 'Untitled anime',
				description: undefined,
				imageUrl: null,
			}),
		)
		const publicPayload = JSON.stringify(result.data)
		for (const privateValue of Object.values(privateMetadata)) {
			expect(publicPayload).not.toContain(privateValue)
		}
	} finally {
		queryRaw.mockRestore()
	}
})

test('normalized signed-in media loading skips legacy entry reads', async () => {
	const { media, tracker, watching, cookie } = await fixture()
	await prisma.trackingState.create({
		data: {
			ownerId: tracker.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: watching.id,
			score: 8,
		},
	})
	const queryRaw = vi.spyOn(prisma, '$queryRaw')

	try {
		const result = await loader({
			request: new Request(`${BASE_URL}/media/${media.id}`, {
				headers: { cookie },
			}),
			params: { mediaId: media.id },
		} as any)

		expect(
			queryRaw.mock.calls.filter(([query]) =>
				(query as Prisma.Sql).sql?.includes('FROM "Entry"'),
			),
		).toHaveLength(0)
		expect(result.data.viewer?.tracking).toEqual(
			expect.objectContaining({
				status: 'watching',
				statusWatchlistId: watching.id,
				score: 8,
			}),
		)
	} finally {
		queryRaw.mockRestore()
	}
})

test('legacy media loading projects only the current owner entries', async () => {
	const { media, tracker, watching, cookie } = await fixture()
	await prisma.entry.create({
		data: {
			watchlistId: watching.id,
			mediaId: media.id,
			position: 1,
			title: 'Current owner legacy snapshot',
			personal: 7.5,
			length: '3 / 12 eps',
			history: JSON.stringify({
				started: new Date('2026-06-01T00:00:00.000Z').getTime(),
				lastUpdated: new Date('2026-06-02T00:00:00.000Z').getTime(),
			}),
		},
	})
	const queryRaw = vi.spyOn(prisma, '$queryRaw')

	try {
		const result = await loader({
			request: new Request(`${BASE_URL}/media/${media.id}`, {
				headers: { cookie },
			}),
			params: { mediaId: media.id },
		} as any)

		expect(result.data.viewer?.tracking).toEqual(
			expect.objectContaining({
				status: 'watching',
				statusWatchlistId: watching.id,
				score: 7.5,
				progress: [
					expect.objectContaining({
						unit: 'episode',
						current: 3,
						total: 12,
					}),
				],
			}),
		)
		const entryQueries = queryRaw.mock.calls.filter(([query]) =>
			(query as Prisma.Sql).sql?.includes('FROM "Entry"'),
		)
		expect(entryQueries).toHaveLength(1)
		const projection = entryQueries[0]?.[0] as Prisma.Sql
		expect(projection.sql).toContain('"Watchlist"."ownerId" = ?')
		expect(projection.values).toEqual(
			expect.arrayContaining([media.id, tracker.id]),
		)
	} finally {
		queryRaw.mockRestore()
	}
})

test('legacy media loading fails closed on a one-megabyte history value', async () => {
	const { media, tracker, watching, cookie } = await fixture()
	const privateMarker = 'PRIVATE LEGACY HISTORY MUST NOT ESCAPE'
	await prisma.entry.create({
		data: {
			watchlistId: watching.id,
			mediaId: media.id,
			position: 1,
			title: 'Oversized legacy snapshot',
			personal: 9,
			history: `${privateMarker}${'x'.repeat(1024 * 1024)}`,
		},
	})
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

	try {
		const result = await loader({
			request: new Request(`${BASE_URL}/media/${media.id}`, {
				headers: { cookie },
			}),
			params: { mediaId: media.id },
		} as any)

		expect(result.data.viewer?.tracking).toBeNull()
		expect(JSON.stringify(result.data)).not.toContain(privateMarker)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]?.[0])).not.toContain(privateMarker)
		expect(String(warn.mock.calls[0]?.[0])).not.toContain(tracker.id)
		expect(String(warn.mock.calls[0]?.[0])).not.toContain(media.id)
	} finally {
		warn.mockRestore()
	}
})

test('status updates fail closed when the exact destination snapshot is oversized', async () => {
	const { media, tracker, watching, cookie } = await fixture()
	const oversizedHistory = 'x'.repeat(1024 * 1024)
	const entry = await prisma.entry.create({
		data: {
			watchlistId: watching.id,
			mediaId: media.id,
			position: 1,
			title: 'Oversized destination snapshot',
			history: oversizedHistory,
		},
		select: { id: true },
	})
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

	try {
		await expect(
			action({
				request: actionRequest(media.id, cookie, {
					intent: 'status',
					watchlistId: watching.id,
				}),
				params: { mediaId: media.id },
			} as any),
		).rejects.toMatchObject({ status: 409 })
		expect(
			await prisma.trackingState.count({
				where: { ownerId: tracker.id, mediaId: media.id },
			}),
		).toBe(0)
		expect(
			await prisma.entry.findUniqueOrThrow({
				where: { id: entry.id },
				select: { history: true },
			}),
		).toEqual({ history: oversizedHistory })
	} finally {
		warn.mockRestore()
	}
})

test('public media loader permanently redirects an applied merge source', async () => {
	const admin = await user('merge_redirect_admin')
	await prisma.media.createMany({
		data: [
			{
				id: 'redirect-merge-source',
				kind: 'movie',
				title: 'Old record',
				catalogProvenanceVersion: 1,
			},
			{
				id: 'redirect-merge-target',
				kind: 'movie',
				title: 'Canonical record',
				catalogProvenanceVersion: 1,
			},
		],
	})
	const issue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: 'redirect-merge-fingerprint',
			issueType: 'possible_duplicate',
			status: 'confirmed',
			severity: 'warning',
			summary: 'Redirect duplicate',
			evidence: JSON.stringify({ source: 'redirect-test-fixture' }),
			primaryMediaId: 'redirect-merge-source',
			secondaryMediaId: 'redirect-merge-target',
			reviewedById: admin.id,
		},
	})
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: issue.id,
		targetMediaId: 'redirect-merge-target',
		actorId: admin.id,
	})
	await applyCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeConfirmation(
			'redirect-merge-source',
			'redirect-merge-target',
		),
	})

	try {
		await loader({
			request: new Request(`${BASE_URL}/media/redirect-merge-source`),
			params: { mediaId: 'redirect-merge-source' },
		} as any)
		throw new Error('Expected redirect')
	} catch (error) {
		expect(error).toBeInstanceOf(Response)
		expect((error as Response).status).toBe(301)
		expect((error as Response).headers.get('Location')).toBe(
			'/media/redirect-merge-target',
		)
	}
})

test('media loader and actions ignore historical epoch-zero redirects', async () => {
	const member = await user('legacy_redirect_member')
	const cookie = await cookieFor(member.id)
	const target = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Current target',
			catalogProvenanceVersion: 1,
		},
	})
	const issue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: 'legacy-redirect-issue',
			issueType: 'possible_duplicate',
			status: 'resolved',
			summary: 'Historical redirect is not authoritative',
			primaryMediaId: target.id,
		},
	})
	await prisma.catalogMediaMerge.create({
		data: {
			issueId: issue.id,
			status: 'applied',
			sourceMediaId: 'legacy-redirect-source',
			targetMediaId: target.id,
			preflight: '{}',
			preflightFingerprint: 'historical',
			catalogProvenanceVersion: 0,
		},
	})

	await expect(
		loader({
			request: new Request(`${BASE_URL}/media/legacy-redirect-source`),
			params: { mediaId: 'legacy-redirect-source' },
		} as any),
	).rejects.toMatchObject({ status: 404 })
	await expect(
		action({
			request: actionRequest('legacy-redirect-source', cookie, {
				intent: 'favorite-toggle',
			}),
			params: { mediaId: 'legacy-redirect-source' },
		} as any),
	).rejects.toMatchObject({ status: 404 })
})

test('public media loader exposes grouped canonical title relations', async () => {
	const { media, tracker, completed, cookie } = await fixture()
	const [sequel, untrustedSequel] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				catalogProvenanceVersion: 1,
				title: 'Fullmetal Alchemist: The Next Chapter',
				type: 'TV Series',
				startSeason: 'Spring 2011',
				thumbnail:
					'https://example.com/sequel.jpg|https://myanimelist.net/anime/6000',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				catalogProvenanceVersion: 1,
				title: 'Untrusted Private Relation Snapshot',
			},
		}),
	])
	await prisma.mediaRelation.createMany({
		data: [
			{
				sourceMediaId: media.id,
				targetMediaId: sequel.id,
				relationType: 'sequel',
				provider: 'mal',
				catalogProvenanceVersion: 1,
			},
			{
				sourceMediaId: media.id,
				targetMediaId: untrustedSequel.id,
				relationType: 'adaptation',
				provider: 'mal',
				catalogProvenanceVersion: 0,
			},
		],
	})
	await prisma.trackingState.create({
		data: {
			ownerId: tracker.id,
			mediaId: sequel.id,
			status: 'completed',
			statusWatchlistId: completed.id,
			score: 9,
		},
	})

	const result = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`),
		params: { mediaId: media.id },
	} as any)
	expect(result.data.relations).toEqual([
		{
			relationType: 'sequel',
			label: 'Sequel',
			items: [
				expect.objectContaining({
					id: sequel.id,
					title: 'Fullmetal Alchemist: The Next Chapter',
					type: 'TV Series',
					year: '2011',
					imageUrl: 'https://example.com/sequel.jpg',
					trackerCount: 1,
					viewerTracking: null,
				}),
			],
		},
	])
	expect(JSON.stringify(result.data.relations)).not.toContain(
		'Untrusted Private Relation Snapshot',
	)

	const signedInResult = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(signedInResult.data.relations[0]?.items[0]).toMatchObject({
		trackerCount: 1,
		viewerTracking: {
			status: 'completed',
			statusLabel: 'Completed',
			score: 9,
		},
	})
})

test('signed-in media loader shows tracking only from followed members', async () => {
	const { media, tracker, otherUser, otherList, cookie } = await fixture()
	const stranger = await user('media_stranger')
	await Promise.all([
		prisma.follow.create({
			data: { followerId: tracker.id, followingId: otherUser.id },
		}),
		prisma.trackingState.create({
			data: {
				ownerId: otherUser.id,
				mediaId: media.id,
				status: 'watching',
				statusWatchlistId: otherList.id,
				score: 7.5,
			},
		}),
		prisma.trackingState.create({
			data: {
				ownerId: stranger.id,
				mediaId: media.id,
				status: 'completed',
				score: 10,
			},
		}),
	])

	const result = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(result.data.socialContext).toMatchObject({
		total: 1,
		ratings: 1,
		meanScore: 7.5,
		items: [
			expect.objectContaining({
				status: 'watching',
				statusLabel: 'Watching',
				score: 7.5,
				member: expect.objectContaining({ id: otherUser.id }),
			}),
		],
	})
	expect(
		result.data.socialContext?.items.some(
			item => item.member.id === stranger.id,
		),
	).toBe(false)

	const anonymous = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`),
		params: { mediaId: media.id },
	} as any)
	expect(anonymous.data.socialContext).toBeNull()
})

test('media favorite toggle updates the title page and profile snapshot', async () => {
	const { media, tracker, cookie } = await fixture()
	await action({
		request: actionRequest(media.id, cookie, { intent: 'favorite-toggle' }),
		params: { mediaId: media.id },
	} as any)

	const favorite = await prisma.userFavorite.findFirstOrThrow({
		where: { ownerId: tracker.id, mediaId: media.id },
		include: { type: { select: { name: true } } },
	})
	expect(favorite).toMatchObject({
		position: 1,
		title: 'Fullmetal Alchemist: Brotherhood',
		thumbnail:
			'https://example.com/fmab.jpg|https://myanimelist.net/anime/5114',
		mediaType: 'TV',
		startYear: 'Fall 2009',
		type: { name: 'anime' },
	})

	const favorited = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(favorited.data.viewer?.isFavorite).toBe(true)
	expect(favorited.data.community.favorites).toBe(1)
	await prisma.userFavorite.create({
		data: {
			ownerId: tracker.id,
			mediaId: media.id,
			typeId: favorite.typeId,
			position: 2,
			title: 'Duplicate legacy favorite',
		},
	})

	await action({
		request: actionRequest(media.id, cookie, { intent: 'favorite-toggle' }),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.userFavorite.count({
			where: { ownerId: tracker.id, mediaId: media.id },
		}),
	).toBe(0)

	const removed = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(removed.data.viewer?.isFavorite).toBe(false)
	expect(removed.data.community.favorites).toBe(0)
})

test('favorites never copy another owners private entry metadata', async () => {
	const { media, tracker, cookie } = await fixture()
	const privateMetadata = {
		title: 'PRIVATE FAVORITE TITLE MUST NOT ESCAPE',
		thumbnail: 'https://private.example/favorite-cover.jpg',
		description: 'PRIVATE FAVORITE DESCRIPTION MUST NOT ESCAPE',
	}
	await Promise.all([
		prisma.media.update({
			where: { id: media.id },
			data: {
				title: null,
				thumbnail: null,
				description: null,
				type: null,
				startSeason: null,
			},
		}),
		prisma.entry.updateMany({
			where: { mediaId: media.id },
			data: privateMetadata,
		}),
	])

	await action({
		request: actionRequest(media.id, cookie, { intent: 'favorite-toggle' }),
		params: { mediaId: media.id },
	} as any)

	const favorite = await prisma.userFavorite.findFirstOrThrow({
		where: { ownerId: tracker.id, mediaId: media.id },
	})
	expect(favorite).toEqual(
		expect.objectContaining({
			title: 'Untitled anime',
			thumbnail: null,
			mediaType: null,
			startYear: null,
		}),
	)
	const storedFavorite = JSON.stringify(favorite)
	for (const privateValue of Object.values(privateMetadata)) {
		expect(storedFavorite).not.toContain(privateValue)
	}
})

test('public media author payloads omit optional real names', async () => {
	const { media, tracker, otherUser, otherList, cookie } = await fixture()
	const trackerRealName = 'TRACKER REAL NAME MUST STAY PRIVATE'
	const otherRealName = 'AUTHOR REAL NAME MUST STAY PRIVATE'
	await Promise.all([
		prisma.user.update({
			where: { id: tracker.id },
			data: { name: trackerRealName },
		}),
		prisma.user.update({
			where: { id: otherUser.id },
			data: { name: otherRealName },
		}),
		prisma.follow.create({
			data: { followerId: tracker.id, followingId: otherUser.id },
		}),
	])
	const tracking = await prisma.trackingState.create({
		data: {
			ownerId: otherUser.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: otherList.id,
		},
	})
	const review = await prisma.review.create({
		data: {
			authorId: otherUser.id,
			mediaId: media.id,
			body: 'A public review without profile real-name metadata.',
		},
	})
	await Promise.all([
		prisma.reviewComment.create({
			data: {
				authorId: tracker.id,
				reviewId: review.id,
				body: 'A public comment without profile real-name metadata.',
			},
		}),
		prisma.activityEvent.create({
			data: {
				type: 'status',
				actorId: otherUser.id,
				mediaId: media.id,
				trackingStateId: tracking.id,
				status: 'watching',
				statusLabel: 'Watching',
				statusWatchlistId: otherList.id,
				isPublic: true,
				publicEligible: true,
			},
		}),
	])

	const result = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)

	expect(result.data.socialContext?.items[0]?.member).not.toHaveProperty('name')
	expect(result.data.activity[0]?.actor).not.toHaveProperty('name')
	expect(result.data.reviews[0]?.author).not.toHaveProperty('name')
	expect(result.data.reviews[0]?.comments[0]?.author).not.toHaveProperty('name')
	const publicPayload = JSON.stringify(result.data)
	expect(publicPayload).not.toContain(trackerRealName)
	expect(publicPayload).not.toContain(otherRealName)
})

test('tracking controls create and dual-write status, score, and progress', async () => {
	const { media, tracker, watching, completed, cookie } = await fixture()
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'status',
			watchlistId: watching.id,
		}),
		params: { mediaId: media.id },
	} as any)

	let entry = await prisma.entry.findFirstOrThrow({
		where: { mediaId: media.id, watchlist: { ownerId: tracker.id } },
	})
	let state = await prisma.trackingState.findUniqueOrThrow({
		where: { ownerId_mediaId: { ownerId: tracker.id, mediaId: media.id } },
	})
	expect(entry.watchlistId).toBe(watching.id)
	expect(entry.title).toBe('Fullmetal Alchemist: Brotherhood')
	expect(entry.trackingStateId).toBe(state.id)
	expect(state.status).toBe('watching')

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'score',
			score: '8.5',
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'score',
			score: '8.5',
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'progress',
			unit: 'episode',
			current: '3',
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'status',
			watchlistId: completed.id,
		}),
		params: { mediaId: media.id },
	} as any)

	entry = await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } })
	const finalState = await prisma.trackingState.findUniqueOrThrow({
		where: { id: state.id },
		include: { progress: true },
	})
	expect(entry.watchlistId).toBe(completed.id)
	expect(Number(entry.personal)).toBe(8.5)
	expect(entry.length).toBe('3 / 12 eps')
	expect(
		(JSON.parse(entry.history ?? '{}') as any).progress[3].finishDate,
	).toHaveLength(1)
	expect(finalState.status).toBe('completed')
	expect(finalState.statusWatchlistId).toBe(completed.id)
	expect(Number(finalState.score)).toBe(8.5)
	expect(finalState.progress).toEqual([
		expect.objectContaining({ unit: 'episode', current: 3, total: 12 }),
	])
	const events = await prisma.activityEvent.findMany({
		where: { actorId: tracker.id, mediaId: media.id },
	})
	expect(events).toHaveLength(4)
	expect(events.filter(event => event.type === 'status')).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				status: 'watching',
				statusLabel: 'Watching',
				previousStatus: null,
			}),
			expect.objectContaining({
				status: 'completed',
				statusLabel: 'Completed',
				previousStatus: 'watching',
			}),
		]),
	)
	expect(Number(events.find(event => event.type === 'score')?.score)).toBe(8.5)
	expect(events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				type: 'progress',
				progressUnit: 'episode',
				progressPrevious: 0,
				progressCurrent: 3,
				progressTotal: 12,
			}),
		]),
	)

	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(loaded.data.community).toMatchObject({
		trackers: 1,
		ratings: 1,
		meanScore: 8.5,
		reviews: 0,
		diaryEntries: 0,
	})
	expect(loaded.data.community.statusBreakdown).toEqual([
		{
			status: 'completed',
			label: 'Completed',
			count: 1,
			percentage: 100,
		},
	])
	expect(
		loaded.data.community.scoreDistribution.find(bucket => bucket.score === 9),
	).toEqual({ score: 9, count: 1, percentage: 100 })
	expect(loaded.data.viewer?.tracking).toEqual(
		expect.objectContaining({
			status: 'completed',
			score: 8.5,
			progress: [expect.objectContaining({ unit: 'episode', current: 3 })],
		}),
	)
	expect(loaded.data.activity.map(event => event.action)).toEqual(
		expect.arrayContaining([
			'Added to Watching',
			'Rated 8.5/10',
			'Watched episodes 1–3',
			'Moved from Watching to Completed',
		]),
	)
})

test('members can publish and edit one spoiler-aware review per title', async () => {
	const { media, tracker, otherUser, cookie } = await fixture()

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'review-save',
			body: '  The adaptation earns its emotional ending.  ',
			containsSpoilers: 'true',
			rating: '9.2',
		}),
		params: { mediaId: media.id },
	} as any)

	const original = await prisma.review.findUniqueOrThrow({
		where: { authorId_mediaId: { authorId: tracker.id, mediaId: media.id } },
	})
	expect(original.body).toBe('The adaptation earns its emotional ending.')
	expect(original.containsSpoilers).toBe(true)
	expect(Number(original.rating)).toBe(9.2)

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'review-save',
			body: 'A tighter second draft.',
			rating: '',
		}),
		params: { mediaId: media.id },
	} as any)

	const updated = await prisma.review.findUniqueOrThrow({
		where: { authorId_mediaId: { authorId: tracker.id, mediaId: media.id } },
	})
	expect(updated.id).toBe(original.id)
	expect(updated.body).toBe('A tighter second draft.')
	expect(updated.containsSpoilers).toBe(false)
	expect(updated.rating).toBeNull()
	expect(await prisma.review.count({ where: { mediaId: media.id } })).toBe(1)

	const publicResult = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`),
		params: { mediaId: media.id },
	} as any)
	expect(publicResult.data.community.reviews).toBe(1)
	expect(publicResult.data.reviews).toEqual([
		expect.objectContaining({
			id: original.id,
			body: 'A tighter second draft.',
			containsSpoilers: false,
			rating: null,
			author: expect.objectContaining({ id: tracker.id }),
		}),
	])
	await prisma.review.update({
		where: { id: original.id },
		data: { moderationStatus: 'hidden' },
	})
	const moderatedResult = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`),
		params: { mediaId: media.id },
	} as any)
	expect(moderatedResult.data.community.reviews).toBe(0)
	expect(moderatedResult.data.reviews).toEqual([])

	const otherSession = await prisma.session.create({
		data: {
			userId: otherUser.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const otherCookie = await getSessionCookieHeader(otherSession)
	const denied = await action({
		request: actionRequest(media.id, otherCookie, {
			intent: 'review-delete',
		}),
		params: { mediaId: media.id },
	} as any).catch(error => error)
	expect(denied).toBeInstanceOf(Response)
	expect((denied as Response).status).toBe(404)
	expect(
		await prisma.review.findUnique({ where: { id: original.id } }),
	).not.toBeNull()
})

test('diary logs are repeatable, dated, and protected by ownership', async () => {
	const { media, tracker, otherUser, cookie } = await fixture()

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'diary-create',
			loggedOn: '2026-07-18',
			isRepeat: 'true',
			rating: '8.7',
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'diary-create',
			loggedOn: '2026-07-19',
			rating: '',
		}),
		params: { mediaId: media.id },
	} as any)

	const entries = await prisma.diaryEntry.findMany({
		where: { ownerId: tracker.id, mediaId: media.id },
		orderBy: { loggedOn: 'asc' },
	})
	expect(entries).toHaveLength(2)
	expect(entries[0]).toEqual(
		expect.objectContaining({
			loggedOn: new Date('2026-07-18T00:00:00.000Z'),
			isRepeat: true,
		}),
	)
	expect(Number(entries[0]?.rating)).toBe(8.7)
	expect(entries[1]?.rating).toBeNull()

	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(loaded.data.community.diaryEntries).toBe(2)
	expect(loaded.data.viewer?.diaryEntries.map(entry => entry.id)).toEqual([
		entries[1]?.id,
		entries[0]?.id,
	])

	const otherSession = await prisma.session.create({
		data: {
			userId: otherUser.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const otherCookie = await getSessionCookieHeader(otherSession)
	const denied = await action({
		request: actionRequest(media.id, otherCookie, {
			intent: 'diary-delete',
			diaryEntryId: entries[0]!.id,
		}),
		params: { mediaId: media.id },
	} as any).catch(error => error)
	expect(denied).toBeInstanceOf(Response)
	expect((denied as Response).status).toBe(404)
	expect(
		await prisma.diaryEntry.findUnique({ where: { id: entries[0]!.id } }),
	).not.toBeNull()

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'diary-delete',
			diaryEntryId: entries[0]!.id,
		}),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.diaryEntry.findUnique({ where: { id: entries[0]!.id } }),
	).toBeNull()
})

test('invalid review and diary input is rejected before writing', async () => {
	const { media, cookie } = await fixture()
	const invalidData: Array<Record<string, string>> = [
		{ intent: 'review-save', body: '   ', rating: '8' },
		{ intent: 'diary-create', loggedOn: '2026-02-29', rating: '8' },
		{ intent: 'diary-create', loggedOn: '2026-07-19', rating: '11' },
	]
	for (const data of invalidData) {
		const result = await action({
			request: actionRequest(media.id, cookie, data),
			params: { mediaId: media.id },
		} as any).catch(error => error)
		expect(result).toBeInstanceOf(Response)
		expect((result as Response).status).toBe(400)
	}
	expect(await prisma.review.count({ where: { mediaId: media.id } })).toBe(0)
	expect(await prisma.diaryEntry.count({ where: { mediaId: media.id } })).toBe(
		0,
	)
})

test('review likes, threaded comments, and notifications stay synchronized', async () => {
	const { media, tracker, otherUser, cookie } = await fixture()
	const review = await prisma.review.create({
		data: {
			authorId: otherUser.id,
			mediaId: media.id,
			body: 'A review ready for discussion.',
		},
	})

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'review-like-toggle',
			reviewId: review.id,
		}),
		params: { mediaId: media.id },
	} as any)
	const like = await prisma.reviewLike.findUniqueOrThrow({
		where: { userId_reviewId: { userId: tracker.id, reviewId: review.id } },
	})
	expect(
		await prisma.notification.findUnique({
			where: { reviewLikeId: like.id },
		}),
	).toMatchObject({
		type: 'review_like',
		recipientId: otherUser.id,
		actorId: tracker.id,
	})

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'review-comment-create',
			reviewId: review.id,
			body: '  A thoughtful first comment.  ',
		}),
		params: { mediaId: media.id },
	} as any)
	const parent = await prisma.reviewComment.findFirstOrThrow({
		where: { reviewId: review.id, authorId: tracker.id },
	})
	expect(parent.body).toBe('A thoughtful first comment.')
	expect(
		await prisma.notification.findUnique({
			where: { reviewCommentId: parent.id },
		}),
	).toMatchObject({
		type: 'review_comment',
		recipientId: otherUser.id,
		actorId: tracker.id,
	})

	const authorCookie = await cookieFor(otherUser.id)
	await action({
		request: actionRequest(media.id, authorCookie, {
			intent: 'review-comment-create',
			reviewId: review.id,
			parentId: parent.id,
			body: 'Thanks for joining the discussion.',
		}),
		params: { mediaId: media.id },
	} as any)
	const reply = await prisma.reviewComment.findFirstOrThrow({
		where: { parentId: parent.id },
	})
	await prisma.reviewComment.update({
		where: { id: parent.id },
		data: { moderationStatus: 'hidden' },
	})
	expect(
		await prisma.notification.findUnique({
			where: { reviewCommentId: reply.id },
		}),
	).toMatchObject({
		type: 'review_reply',
		recipientId: tracker.id,
		actorId: otherUser.id,
	})

	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(loaded.data.reviews).toEqual([
		expect.objectContaining({
			id: review.id,
			viewerLiked: true,
			_count: { likes: 1, comments: 2 },
			comments: [
				expect.objectContaining({
					id: parent.id,
					parentId: null,
					body: '[Removed by moderation]',
					isRemoved: true,
				}),
				expect.objectContaining({ id: reply.id, parentId: parent.id }),
			],
		}),
	])

	await action({
		request: actionRequest(media.id, authorCookie, {
			intent: 'review-comment-delete',
			commentId: parent.id,
		}),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.reviewComment.count({ where: { reviewId: review.id } }),
	).toBe(0)
	expect(
		await prisma.notification.count({
			where: {
				reviewId: review.id,
				type: { in: ['review_comment', 'review_reply'] },
			},
		}),
	).toBe(0)

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'review-like-toggle',
			reviewId: review.id,
		}),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.reviewLike.count({ where: { reviewId: review.id } }),
	).toBe(0)
	expect(
		await prisma.notification.count({ where: { reviewId: review.id } }),
	).toBe(0)
})

test('status action rejects a watchlist owned by someone else', async () => {
	const { media, tracker, otherList, cookie } = await fixture()
	const result = await action({
		request: actionRequest(media.id, cookie, {
			intent: 'status',
			watchlistId: otherList.id,
		}),
		params: { mediaId: media.id },
	} as any).catch(error => error)

	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(400)
	expect(
		await prisma.entry.count({
			where: { mediaId: media.id, watchlist: { ownerId: tracker.id } },
		}),
	).toBe(0)
})

test('media pages add titles only to collections owned by the viewer', async () => {
	const { media, tracker, otherUser, cookie } = await fixture()
	const [owned, other] = await Promise.all([
		prisma.mediaCollection.create({
			data: { ownerId: tracker.id, title: 'Owned picks' },
		}),
		prisma.mediaCollection.create({
			data: { ownerId: otherUser.id, title: 'Someone else’s picks' },
		}),
	])

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'collection-add',
			collectionId: owned.id,
		}),
		params: { mediaId: media.id },
	} as any)
	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'collection-add',
			collectionId: owned.id,
		}),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.mediaCollectionItem.count({
			where: { collectionId: owned.id, mediaId: media.id },
		}),
	).toBe(1)

	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(loaded.data.viewer?.collections).toEqual([
		expect.objectContaining({ id: owned.id, containsMedia: true }),
	])
	expect(loaded.data.viewer?.collectionsTruncated).toBe(false)

	const denied = await action({
		request: actionRequest(media.id, cookie, {
			intent: 'collection-add',
			collectionId: other.id,
		}),
		params: { mediaId: media.id },
	} as any).catch(error => error)
	expect(denied).toBeInstanceOf(Response)
	expect((denied as Response).status).toBe(404)
})

test('media pages bound recent collection choices and serialize membership only', async () => {
	const { media, tracker, cookie } = await fixture()
	const collectionCount = MEDIA_DETAIL_COLLECTION_LIMIT + 2
	const collectionId = (index: number) =>
		`${tracker.id}-media-detail-collection-${index}`

	await prisma.mediaCollection.createMany({
		data: Array.from({ length: collectionCount }, (_, index) => ({
			id: collectionId(index),
			ownerId: tracker.id,
			title: `Collection ${String(index).padStart(3, '0')}`,
			updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
		})),
	})
	await prisma.mediaCollectionItem.create({
		data: {
			collectionId: collectionId(collectionCount - 1),
			mediaId: media.id,
			position: 0,
		},
	})

	const findMany = vi.spyOn(prisma.mediaCollection, 'findMany')
	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	const collectionQuery = findMany.mock.lastCall?.[0]
	findMany.mockRestore()
	const collections = loaded.data.viewer?.collections ?? []

	expect(collectionQuery).toMatchObject({
		where: { ownerId: tracker.id },
		take: MEDIA_DETAIL_COLLECTION_LIMIT + 1,
		select: {
			id: true,
			title: true,
			_count: {
				select: { items: { where: { mediaId: media.id } } },
			},
		},
	})
	expect(collectionQuery?.select).not.toHaveProperty('items')
	expect(collections).toHaveLength(MEDIA_DETAIL_COLLECTION_LIMIT)
	expect(loaded.data.viewer?.collectionsTruncated).toBe(true)
	expect(collections[0]).toEqual({
		id: collectionId(collectionCount - 1),
		title: `Collection ${String(collectionCount - 1).padStart(3, '0')}`,
		containsMedia: true,
	})
	expect(collections.at(-1)?.id).toBe(collectionId(2))
	expect(
		collections.some(collection => collection.id === collectionId(1)),
	).toBe(false)
	for (const collection of collections) {
		expect(collection).not.toHaveProperty('items')
		expect(collection).not.toHaveProperty('_count')
	}
})

test('members can create, update, and remove a release reminder', async () => {
	const { media, tracker, cookie } = await fixture()
	const releaseAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
	await prisma.media.update({
		where: { id: media.id },
		data: {
			nextRelease: JSON.stringify({
				releaseDate: releaseAt.toISOString(),
				episode: 2,
			}),
		},
	})

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'release-reminder-save',
			leadMinutes: '60',
		}),
		params: { mediaId: media.id },
	} as any)
	const reminder = await prisma.releaseReminder.findUniqueOrThrow({
		where: { ownerId_mediaId: { ownerId: tracker.id, mediaId: media.id } },
		include: { notifications: true },
	})
	expect(reminder.leadMinutes).toBe(60)
	expect(reminder.notifications).toHaveLength(1)
	expect(reminder.notifications[0]).toMatchObject({
		releaseAt,
		availableAt: new Date(releaseAt.getTime() - 60 * 60 * 1000),
	})

	const loaded = await loader({
		request: new Request(`${BASE_URL}/media/${media.id}`, {
			headers: { cookie },
		}),
		params: { mediaId: media.id },
	} as any)
	expect(loaded.data.viewer?.reminder).toEqual({
		id: reminder.id,
		leadMinutes: 60,
	})
	expect(loaded.data.media.upcomingRelease).toMatchObject({
		label: 'Episode 2',
		releaseAt,
	})

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'release-reminder-save',
			leadMinutes: '0',
		}),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.releaseReminder.findUniqueOrThrow({
			where: { id: reminder.id },
			include: { notifications: true },
		}),
	).toMatchObject({
		leadMinutes: 0,
		notifications: [expect.objectContaining({ availableAt: releaseAt })],
	})

	const invalid = await action({
		request: actionRequest(media.id, cookie, {
			intent: 'release-reminder-save',
			leadMinutes: '30',
		}),
		params: { mediaId: media.id },
	} as any).catch(error => error)
	expect(invalid).toBeInstanceOf(Response)
	expect((invalid as Response).status).toBe(400)

	await action({
		request: actionRequest(media.id, cookie, {
			intent: 'release-reminder-delete',
		}),
		params: { mediaId: media.id },
	} as any)
	expect(
		await prisma.releaseReminder.count({
			where: { ownerId: tracker.id, mediaId: media.id },
		}),
	).toBe(0)
	expect(
		await prisma.notification.count({
			where: { releaseReminderId: reminder.id },
		}),
	).toBe(0)
})
