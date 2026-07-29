import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	dateKeyInTimeZone,
	getReleaseCalendar,
	isReleaseCalendarCapacityError,
	isPlausibleNextRelease,
	normalizeTimeZone,
	parseReleaseCalendarQuery,
	parseStoredNextRelease,
} from './release-calendar.server.ts'

const fixedNow = new Date('2030-06-03T12:00:00.000Z')
const fixedQuery = {
	start: '2030-06-03',
	kind: 'all',
	scope: 'all',
} as const

function calendarTestOptions(
	testing: NonNullable<
		NonNullable<Parameters<typeof getReleaseCalendar>[3]>['testing']
	> = {},
) {
	return { testing: { now: fixedNow, ...testing } }
}

async function createCalendarUser(label: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${label}_${suffix}@example.com`,
			username: `${label}_${suffix}`,
		},
	})
}

test('normalizes calendar filters and defaults to the current UTC week', () => {
	expect(
		parseReleaseCalendarQuery(
			new URLSearchParams('kind=anime&scope=mine'),
			new Date('2026-07-22T18:00:00.000Z'),
		),
	).toEqual({ start: '2026-07-20', kind: 'anime', scope: 'mine' })
	expect(
		parseReleaseCalendarQuery(
			new URLSearchParams('start=2026-02-30&kind=podcast&scope=friends'),
			new Date('2026-07-22T18:00:00.000Z'),
		),
	).toEqual({ start: '2026-07-20', kind: 'all', scope: 'all' })
})

test('uses local calendar dates for default weeks and rejects invalid timezones', () => {
	expect(
		parseReleaseCalendarQuery(
			new URLSearchParams(),
			new Date('2026-07-20T01:00:00.000Z'),
			'America/Los_Angeles',
		),
	).toEqual({ start: '2026-07-13', kind: 'all', scope: 'all' })
	expect(
		dateKeyInTimeZone(
			new Date('2026-07-20T01:00:00.000Z'),
			'America/Los_Angeles',
		),
	).toBe('2026-07-19')
	expect(normalizeTimeZone('not/a-timezone')).toBe('UTC')
})

test('parses stored episode and chapter schedule payloads safely', () => {
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-07-21T18:30:00.000Z',
				source: 'anilist',
				observedAt: '2026-07-20T12:00:00.000Z',
				season: 2,
				episode: 4,
				name: 'The next step',
			}),
		),
	).toMatchObject({
		releaseAt: new Date('2026-07-21T18:30:00.000Z'),
		allDay: false,
		source: 'anilist',
		observedAt: new Date('2026-07-20T12:00:00.000Z'),
		season: 2,
		episode: 4,
		name: 'The next step',
	})
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-07-22',
				volume: 3,
				chapter: 21,
			}),
		),
	).toMatchObject({ allDay: true, volume: 3, chapter: 21 })
	expect(parseStoredNextRelease('{not-json')).toBeNull()
	expect(parseStoredNextRelease('null')).toBeNull()
	expect(
		parseStoredNextRelease(
			JSON.stringify({
				releaseDate: '2026-07-21T18:30:00.000Z',
				source: 'anilist',
			}),
		),
	).toBeNull()
	expect(
		parseStoredNextRelease(
			JSON.stringify({ releaseDate: '2026-07-22T00:00:00.000Z' }),
		),
	).toMatchObject({ allDay: false })
})

test('rejects schedules that contradict completed or long-ended media', () => {
	const next = parseStoredNextRelease(
		JSON.stringify({
			releaseDate: '2026-07-21T18:30:00.000Z',
			episode: 2,
		}),
	)
	expect(next).not.toBeNull()
	if (!next) return

	expect(
		isPlausibleNextRelease(
			next,
			{
				kind: 'anime',
				releaseStart: new Date('2005-01-07T00:00:00.000Z'),
				releaseEnd: new Date('2005-04-01T00:00:00.000Z'),
				releaseStatus: null,
			},
			new Date('2026-07-20T12:00:00.000Z'),
		),
	).toBe(false)
	expect(
		isPlausibleNextRelease(
			next,
			{
				kind: 'anime',
				releaseStart: new Date('2026-04-01T00:00:00.000Z'),
				releaseEnd: new Date('2026-07-14T00:00:00.000Z'),
				releaseStatus: 'Currently Airing',
			},
			new Date('2026-07-20T12:00:00.000Z'),
		),
	).toBe(true)
	expect(
		isPlausibleNextRelease(
			next,
			{
				kind: 'anime',
				releaseStart: new Date('2026-04-01T00:00:00.000Z'),
				releaseEnd: new Date('2026-07-14T00:00:00.000Z'),
				releaseStatus: 'Finished Airing',
			},
			new Date('2026-07-20T12:00:00.000Z'),
		),
	).toBe(false)
})

test('expires provider-observed schedules that have not been refreshed', () => {
	const next = parseStoredNextRelease(
		JSON.stringify({
			releaseDate: '2026-08-20T18:30:00.000Z',
			episode: 8,
			source: 'anilist',
			observedAt: '2026-07-01T12:00:00.000Z',
		}),
	)
	expect(next).not.toBeNull()
	if (!next) return
	const media = {
		kind: 'anime',
		releaseStart: new Date('2026-04-01T00:00:00.000Z'),
		releaseEnd: null,
		releaseStatus: 'Currently Airing',
	}

	expect(
		isPlausibleNextRelease(next, media, new Date('2026-07-10T12:00:00.000Z')),
	).toBe(true)
	expect(
		isPlausibleNextRelease(next, media, new Date('2026-07-20T12:00:00.000Z')),
	).toBe(false)
})

test('loads mirrored legacy schedules and occurrence-only releases', async () => {
	const legacyAt = new Date('2030-06-04T18:30:00.000Z')
	const occurrenceAt = new Date('2030-06-05T19:00:00.000Z')
	const [legacy, occurrenceOnly] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Mirrored legacy episode',
				nextReleaseAt: legacyAt,
				nextRelease: JSON.stringify({
					releaseDate: legacyAt.toISOString(),
					season: 2,
					episode: 4,
				}),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Occurrence only episode',
			},
		}),
	])
	const occurrence = await prisma.releaseOccurrence.create({
		data: {
			mediaId: occurrenceOnly.id,
			source: 'anilist',
			sourceKey: 'episode-5',
			eventType: 'episode',
			releaseAt: occurrenceAt,
			season: 2,
			episode: 5,
			observedAt: fixedNow,
			expiresAt: new Date('2030-06-17T12:00:00.000Z'),
		},
	})

	const result = await getReleaseCalendar(
		fixedQuery,
		null,
		'UTC',
		calendarTestOptions(),
	)
	expect(result.days.flatMap(day => day.items)).toEqual([
		expect.objectContaining({
			mediaId: legacy.id,
			eventType: 'episode',
			eventLabel: 'Season 2 · Episode 4',
		}),
		expect.objectContaining({
			id: occurrence.id,
			mediaId: occurrenceOnly.id,
			eventType: 'episode',
			eventLabel: 'Season 2 · Episode 5',
		}),
	])
})

test('fails on a candidate-union overflow instead of truncating the calendar', async () => {
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Capacity premiere',
			releaseStart: new Date('2030-06-04T00:00:00.000Z'),
		},
	})
	const occurrenceOnly = await prisma.media.create({
		data: { kind: 'anime', title: 'Capacity occurrence' },
	})
	await prisma.releaseOccurrence.create({
		data: {
			mediaId: occurrenceOnly.id,
			source: 'anilist',
			sourceKey: 'capacity',
			eventType: 'episode',
			releaseAt: new Date('2030-06-05T18:00:00.000Z'),
			episode: 1,
			observedAt: fixedNow,
			expiresAt: new Date('2030-06-17T12:00:00.000Z'),
		},
	})

	let thrown: unknown
	try {
		await getReleaseCalendar(
			fixedQuery,
			null,
			'UTC',
			calendarTestOptions({ candidateLimit: 1 }),
		)
	} catch (error) {
		thrown = error
	}
	expect(isReleaseCalendarCapacityError(thrown)).toBe(true)
	if (!isReleaseCalendarCapacityError(thrown)) return
	expect(thrown).toMatchObject({
		code: 'RELEASE_CALENDAR_CAPACITY',
		source: 'candidate-union',
		limit: 1,
	})
})

test('caps release-start candidates before loading calendar details', async () => {
	await prisma.media.createMany({
		data: [
			{
				kind: 'movie',
				title: 'Release-start capacity one',
				releaseStart: new Date('2030-06-04T00:00:00.000Z'),
			},
			{
				kind: 'movie',
				title: 'Release-start capacity two',
				releaseStart: new Date('2030-06-05T00:00:00.000Z'),
			},
		],
	})

	await expect(
		getReleaseCalendar(
			fixedQuery,
			null,
			'UTC',
			calendarTestOptions({ candidateLimit: 1 }),
		),
	).rejects.toMatchObject({
		code: 'RELEASE_CALENDAR_CAPACITY',
		source: 'release-start',
		limit: 1,
	})
})

test('caps mirrored next-release candidates before loading calendar details', async () => {
	const releaseDates = [
		new Date('2030-06-04T18:00:00.000Z'),
		new Date('2030-06-05T18:00:00.000Z'),
	]
	await prisma.media.createMany({
		data: releaseDates.map((releaseAt, index) => ({
			kind: 'anime',
			title: `Next-release capacity ${index + 1}`,
			nextReleaseAt: releaseAt,
			nextRelease: JSON.stringify({
				releaseDate: releaseAt.toISOString(),
				episode: index + 1,
			}),
		})),
	})

	await expect(
		getReleaseCalendar(
			fixedQuery,
			null,
			'UTC',
			calendarTestOptions({ candidateLimit: 1 }),
		),
	).rejects.toMatchObject({
		code: 'RELEASE_CALENDAR_CAPACITY',
		source: 'next-release',
		limit: 1,
	})
})

test('caps occurrence rows independently of the candidate union', async () => {
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Occurrence capacity' },
	})
	await prisma.releaseOccurrence.createMany({
		data: [
			{
				mediaId: media.id,
				source: 'anilist',
				sourceKey: 'capacity-1',
				eventType: 'episode',
				releaseAt: new Date('2030-06-04T18:00:00.000Z'),
				episode: 1,
				observedAt: fixedNow,
				expiresAt: new Date('2030-06-17T12:00:00.000Z'),
			},
			{
				mediaId: media.id,
				source: 'anilist',
				sourceKey: 'capacity-2',
				eventType: 'episode',
				releaseAt: new Date('2030-06-05T18:00:00.000Z'),
				episode: 2,
				observedAt: fixedNow,
				expiresAt: new Date('2030-06-17T12:00:00.000Z'),
			},
		],
	})

	await expect(
		getReleaseCalendar(
			fixedQuery,
			null,
			'UTC',
			calendarTestOptions({ occurrenceLimit: 1 }),
		),
	).rejects.toMatchObject({
		code: 'RELEASE_CALENDAR_CAPACITY',
		source: 'occurrences',
		limit: 1,
	})
})

test('counts only public tracking while private tracking still qualifies mine', async () => {
	const [viewer, publicMember, unlistedMember, privateMember] =
		await Promise.all([
			createCalendarUser('calendar_viewer'),
			createCalendarUser('calendar_public'),
			createCalendarUser('calendar_unlisted'),
			createCalendarUser('calendar_private'),
		])
	const listType = await prisma.listType.create({
		data: {
			name: `calendar_${faker.string.alphanumeric(10).toLowerCase()}`,
			header: 'Calendar',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const [viewerPrivateList, publicList, otherPrivateList] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: viewer.id,
				typeId: listType.id,
				name: 'viewer-private',
				header: 'Viewer private',
				isPublic: false,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: publicMember.id,
				typeId: listType.id,
				name: 'public',
				header: 'Public',
				isPublic: true,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: privateMember.id,
				typeId: listType.id,
				name: 'other-private',
				header: 'Other private',
				isPublic: false,
			},
		}),
	])
	const [tracked, untracked] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Privately qualified release',
				releaseStart: new Date('2030-06-04T00:00:00.000Z'),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Untracked release',
				releaseStart: new Date('2030-06-05T00:00:00.000Z'),
			},
		}),
	])
	await prisma.trackingState.createMany({
		data: [
			{
				ownerId: viewer.id,
				mediaId: tracked.id,
				status: 'watching',
				statusWatchlistId: viewerPrivateList.id,
				score: 9,
			},
			{
				ownerId: publicMember.id,
				mediaId: tracked.id,
				status: 'completed',
				statusWatchlistId: publicList.id,
			},
			{
				ownerId: unlistedMember.id,
				mediaId: tracked.id,
				status: 'planning',
				statusWatchlistId: null,
			},
			{
				ownerId: privateMember.id,
				mediaId: tracked.id,
				status: 'watching',
				statusWatchlistId: otherPrivateList.id,
			},
		],
	})

	const result = await getReleaseCalendar(
		{ ...fixedQuery, kind: 'anime', scope: 'mine' },
		viewer.id,
		'UTC',
		calendarTestOptions({ readChunkSize: 1 }),
	)
	expect(result.filters.scope).toBe('mine')
	expect(result.days.flatMap(day => day.items)).toEqual([
		expect.objectContaining({
			mediaId: tracked.id,
			trackerCount: 2,
			viewerTracking: {
				status: 'watching',
				statusLabel: 'Viewer private',
				score: 9,
			},
		}),
	])
	expect(
		result.days
			.flatMap(day => day.items)
			.some(item => item.mediaId === untracked.id),
	).toBe(false)
})

test('qualifies occurrence-only releases through the viewer mine scope', async () => {
	const viewer = await createCalendarUser('calendar_occurrence_scope')
	const [tracked, untracked] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Tracked occurrence-only release' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Untracked occurrence-only release' },
		}),
	])
	await Promise.all([
		prisma.trackingState.create({
			data: {
				ownerId: viewer.id,
				mediaId: tracked.id,
				status: 'watching',
			},
		}),
		prisma.releaseOccurrence.createMany({
			data: [
				{
					mediaId: tracked.id,
					source: 'anilist',
					sourceKey: 'tracked-occurrence',
					eventType: 'episode',
					releaseAt: new Date('2030-06-04T18:00:00.000Z'),
					episode: 3,
					observedAt: fixedNow,
					expiresAt: new Date('2030-06-17T12:00:00.000Z'),
				},
				{
					mediaId: untracked.id,
					source: 'anilist',
					sourceKey: 'untracked-occurrence',
					eventType: 'episode',
					releaseAt: new Date('2030-06-05T18:00:00.000Z'),
					episode: 4,
					observedAt: fixedNow,
					expiresAt: new Date('2030-06-17T12:00:00.000Z'),
				},
			],
		}),
	])

	const result = await getReleaseCalendar(
		{ ...fixedQuery, kind: 'anime', scope: 'mine' },
		viewer.id,
		'UTC',
		calendarTestOptions(),
	)
	expect(result.days.flatMap(day => day.items)).toEqual([
		expect.objectContaining({
			mediaId: tracked.id,
			eventLabel: 'Episode 3',
			viewerTracking: expect.objectContaining({ status: 'watching' }),
		}),
	])
	expect(
		result.days
			.flatMap(day => day.items)
			.some(item => item.mediaId === untracked.id),
	).toBe(false)
})

test('loads viewer tracking and reminders across multiple read chunks', async () => {
	const viewer = await createCalendarUser('calendar_chunked_viewer')
	const media = await Promise.all(
		[
			['Chunked premiere one', '2030-06-04T00:00:00.000Z'],
			['Chunked premiere two', '2030-06-05T00:00:00.000Z'],
			['Chunked premiere three', '2030-06-06T00:00:00.000Z'],
		].map(([title, releaseStart]) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title,
					releaseStart: new Date(releaseStart),
				},
			}),
		),
	)
	await prisma.trackingState.createMany({
		data: media.map((item, index) => ({
			ownerId: viewer.id,
			mediaId: item.id,
			status: ['watching', 'completed', 'planning'][index]!,
			score: [7, 8, 9][index]!,
		})),
	})
	const reminders = await Promise.all(
		media.map((item, index) =>
			prisma.releaseReminder.create({
				data: {
					ownerId: viewer.id,
					mediaId: item.id,
					leadMinutes: [0, 60, 1440][index]!,
				},
			}),
		),
	)

	const result = await getReleaseCalendar(
		{ ...fixedQuery, kind: 'movie', scope: 'mine' },
		viewer.id,
		'UTC',
		calendarTestOptions({ readChunkSize: 1 }),
	)
	expect(result.days.flatMap(day => day.items)).toEqual(
		media.map((item, index) =>
			expect.objectContaining({
				mediaId: item.id,
				trackerCount: 1,
				viewerTracking: expect.objectContaining({
					status: ['watching', 'completed', 'planning'][index],
					score: [7, 8, 9][index],
				}),
				viewerReminder: {
					id: reminders[index]!.id,
					leadMinutes: [0, 60, 1440][index],
				},
			}),
		),
	)
})

test('keeps the UTC envelope bounded while grouping timed releases locally', async () => {
	const schedules = [
		['Local previous day', '2030-06-03T01:30:00.000Z'],
		['Local first day', '2030-06-03T07:30:00.000Z'],
		['Local last day', '2030-06-10T01:30:00.000Z'],
		['Outside UTC envelope', '2030-06-11T00:00:00.000Z'],
	] as const
	const candidates = await Promise.all(
		schedules.map(([title, releaseDate]) =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title,
					nextReleaseAt: new Date(releaseDate),
					nextRelease: JSON.stringify({
						releaseDate,
						episode: 1,
					}),
				},
			}),
		),
	)

	const result = await getReleaseCalendar(
		fixedQuery,
		null,
		'America/Los_Angeles',
		calendarTestOptions({ readChunkSize: 1 }),
	)
	expect(
		result.days.flatMap(day => day.items).map(item => item.mediaId),
	).toEqual([candidates[1]!.id, candidates[2]!.id])
	expect(
		result.days.find(day => day.date === '2030-06-03')?.items[0],
	).toMatchObject({ mediaId: candidates[1]!.id, allDay: false })
	expect(
		result.days.find(day => day.date === '2030-06-09')?.items[0],
	).toMatchObject({ mediaId: candidates[2]!.id, allDay: false })
})

test('covers the UTC+14 and UTC-12 edges of the bounded query envelope', async () => {
	const schedules = [
		['before-plus-fourteen', '2030-06-02T09:59:00.000Z'],
		['start-plus-fourteen', '2030-06-02T10:00:00.000Z'],
		['before-minus-twelve', '2030-06-03T11:59:00.000Z'],
		['start-minus-twelve', '2030-06-03T12:00:00.000Z'],
		['end-plus-fourteen', '2030-06-09T09:59:00.000Z'],
		['after-plus-fourteen', '2030-06-09T10:00:00.000Z'],
		['end-minus-twelve', '2030-06-10T11:59:00.000Z'],
		['after-minus-twelve', '2030-06-10T12:00:00.000Z'],
	] as const
	const candidates = await Promise.all(
		schedules.map(([key, releaseDate]) =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title: key,
					nextReleaseAt: new Date(releaseDate),
					nextRelease: JSON.stringify({
						releaseDate,
						episode: 1,
					}),
				},
			}),
		),
	)
	const ids = Object.fromEntries(
		schedules.map(([key], index) => [key, candidates[index]!.id]),
	)

	const plusFourteen = await getReleaseCalendar(
		fixedQuery,
		null,
		'Pacific/Kiritimati',
		calendarTestOptions({ readChunkSize: 1 }),
	)
	expect(
		plusFourteen.days.flatMap(day => day.items).map(item => item.mediaId),
	).toEqual([
		ids['start-plus-fourteen'],
		ids['before-minus-twelve'],
		ids['start-minus-twelve'],
		ids['end-plus-fourteen'],
	])

	const minusTwelve = await getReleaseCalendar(
		fixedQuery,
		null,
		'Etc/GMT+12',
		calendarTestOptions({ readChunkSize: 1 }),
	)
	expect(
		minusTwelve.days.flatMap(day => day.items).map(item => item.mediaId),
	).toEqual([
		ids['start-minus-twelve'],
		ids['end-plus-fourteen'],
		ids['after-plus-fourteen'],
		ids['end-minus-twelve'],
	])
})
