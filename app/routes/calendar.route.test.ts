import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './calendar.tsx'

async function viewerFixture() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const viewer = await prisma.user.create({
		data: {
			email: `calendar_${suffix}@example.com`,
			username: `calendar_${suffix}`,
		},
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const watching = await prisma.watchlist.create({
		data: {
			ownerId: viewer.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const session = await prisma.session.create({
		data: { userId: viewer.id, expirationDate: getSessionExpirationDate() },
	})
	return {
		viewer,
		watching,
		cookie: await getSessionCookieHeader(session),
	}
}

test('calendar loader groups canonical premieres and scheduled episodes', async () => {
	const { viewer, watching, cookie } = await viewerFixture()
	const [episode, premiere, outside] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Calendar Episode',
				releaseStart: new Date('2026-07-21T00:00:00.000Z'),
				nextRelease: JSON.stringify({
					releaseDate: '2026-07-21T18:30:00.000Z',
					season: 2,
					episode: 4,
					name: 'A scheduled episode',
				}),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Calendar Premiere',
				releaseStart: new Date('2026-07-22T00:00:00.000Z'),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Outside Calendar Week',
				releaseStart: new Date('2026-07-29T00:00:00.000Z'),
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: episode.id,
			status: 'watching',
			statusWatchlistId: watching.id,
			score: 8.5,
		},
	})

	const anonymous = await loader({
		request: new Request(`${BASE_URL}/calendar?start=2026-07-20&scope=mine`),
		params: {},
	} as any)
	expect(anonymous.data.filters.scope).toBe('all')
	expect(anonymous.data.total).toBe(2)
	expect(
		anonymous.data.days.flatMap(day => day.items).map(item => item.title),
	).toEqual(['Calendar Episode', 'Calendar Premiere'])
	expect(
		anonymous.data.days
			.flatMap(day => day.items)
			.find(item => item.mediaId === premiere.id),
	).toMatchObject({ eventType: 'premiere', eventLabel: 'Premiere' })
	expect(anonymous.data.days.flatMap(day => day.items)[0]).toMatchObject({
		eventType: 'episode',
		eventLabel: 'Season 2 · Episode 4',
		trackerCount: 1,
		viewerTracking: null,
	})

	const mine = await loader({
		request: new Request(
			`${BASE_URL}/calendar?start=2026-07-20&kind=anime&scope=mine`,
			{ headers: { cookie } },
		),
		params: {},
	} as any)
	expect(mine.data.total).toBe(1)
	expect(mine.data.days.flatMap(day => day.items)).toEqual([
		expect.objectContaining({
			mediaId: episode.id,
			viewerTracking: {
				status: 'watching',
				statusLabel: 'Watching',
				score: 8.5,
			},
		}),
	])
	expect(
		mine.data.days
			.flatMap(day => day.items)
			.some(item => item.mediaId === outside.id),
	).toBe(false)
})
