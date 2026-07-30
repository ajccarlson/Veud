import { expect, test } from 'vitest'
import {
	fetchMangaUpdatesReleases,
	findMangaUpdatesSeries,
	normalizeMangaUpdatesRelease,
	parseReleaseNumber,
	releaseOccurrenceInput,
	type MangaUpdatesFetch,
} from './mangaupdates-releases.server.ts'

const APPROVAL = 'OWNER-MANGAUPDATES-API-AGREEMENT'
const observedAt = new Date('2026-07-30T12:00:00.000Z')

function stubFetch(payload: unknown, ok = true, status = 200) {
	const calls: Array<{ url: string; body: unknown }> = []
	const impl: MangaUpdatesFetch = async (url, init) => {
		calls.push({ url, body: JSON.parse(init.body) })
		return { ok, status, json: async () => payload }
	}
	return { impl, calls }
}

// Shape taken from a live /v1/releases/search response.
const liveRelease = {
	record: {
		id: 36642,
		title: 'One Piece',
		volume: '48',
		chapter: '467',
		groups: [{ name: 'One Piece HQ' }],
		release_date: '2007-08-18',
	},
}

test('a live release record normalises to a dated chapter', () => {
	const release = normalizeMangaUpdatesRelease(liveRelease)
	expect(release).not.toBeNull()
	expect(release!.sourceKey).toBe('release:36642')
	expect(release!.chapter).toBe(467)
	expect(release!.volume).toBe(48)
	expect(release!.releaseAt.toISOString()).toBe('2007-08-18T00:00:00.000Z')
})

test('chapter numbers that are not plain integers are read or refused, never coerced', () => {
	expect(parseReleaseNumber('467')).toBe(467)
	expect(parseReleaseNumber('c.467')).toBe(467)
	// A range takes its first chapter rather than becoming a wrong single number.
	expect(parseReleaseNumber('12-13')).toBe(12)
	expect(parseReleaseNumber('12.5')).toBe(12)
	for (const value of ['', '   ', 'oneshot', null, undefined, {}, 0, '0']) {
		expect(parseReleaseNumber(value)).toBeNull()
	}
})

test('a record without a usable date is dropped rather than dated by guess', () => {
	for (const release_date of [
		undefined,
		null,
		'',
		'soon',
		'2007-08',
		'August',
	]) {
		expect(
			normalizeMangaUpdatesRelease({
				record: { ...liveRelease.record, release_date },
			}),
		).toBeNull()
	}
})

test('a record identifying neither chapter nor volume is dropped', () => {
	expect(
		normalizeMangaUpdatesRelease({
			record: { ...liveRelease.record, chapter: null, volume: null },
		}),
	).toBeNull()
})

test('a release becomes a chapter occurrence that expires on its own', () => {
	const release = normalizeMangaUpdatesRelease(liveRelease)!
	const input = releaseOccurrenceInput(release, observedAt)
	expect(input.source).toBe('mangaupdates')
	expect(input.eventType).toBe('chapter')
	expect(input.chapter).toBe(467)
	expect(input.allDay).toBe(true)
	// Episodes and seasons belong to anime and must stay unset.
	expect(input.episode).toBeNull()
	expect(input.season).toBeNull()
	expect(input.expiresAt.getTime()).toBeGreaterThan(input.releaseAt.getTime())
})

test('series lookup accepts only an exact title match', async () => {
	const payload = {
		results: [
			{ record: { series_id: 1, title: 'One Piece: Colour Walk' } },
			{ record: { series_id: 55099564912, title: 'One Piece' } },
		],
	}
	const exact = stubFetch(payload)
	// The provider's own canonical title comes back with the id, because release
	// records carry that title and no series id.
	await expect(
		findMangaUpdatesSeries(exact.impl, 'one piece', { approvalRef: APPROVAL }),
	).resolves.toEqual({ seriesId: 55099564912, title: 'One Piece' })

	// A near miss attaches one series' chapters to another title, so it is refused.
	const fuzzy = stubFetch({
		results: [{ record: { series_id: 1, title: 'One Piece: Colour Walk' } }],
	})
	await expect(
		findMangaUpdatesSeries(fuzzy.impl, 'one piece', { approvalRef: APPROVAL }),
	).resolves.toBeNull()
})

test('committed lookups require the documented policy approval reference', async () => {
	const { impl, calls } = stubFetch({ results: [] })
	await expect(findMangaUpdatesSeries(impl, 'one piece', {})).rejects.toThrow(
		/policy-approval-ref/i,
	)
	await expect(
		fetchMangaUpdatesReleases(impl, 'One Piece', {}),
	).rejects.toThrow(/policy-approval-ref/i)
	// Nothing may reach the provider without the reference.
	expect(calls).toHaveLength(0)
})

test('releases from another series are filtered out, not attributed here', async () => {
	// The provider ignores series_id on this endpoint and a release record carries
	// only a title, so a text search returns other series too. Keeping them would
	// file another series' chapters under this one.
	const other = {
		record: { ...liveRelease.record, id: 999, title: 'One Piece: Colour Walk' },
	}
	const { impl, calls } = stubFetch({
		results: [liveRelease, liveRelease, other, { record: { id: 9 } }],
	})
	const releases = await fetchMangaUpdatesReleases(impl, 'One Piece', {
		approvalRef: APPROVAL,
	})
	expect(releases).toHaveLength(1)
	expect(releases[0]!.chapter).toBe(467)
	// An empty search is rejected by the provider, so the title is always sent.
	expect((calls[0]!.body as { search: string }).search).toBe('One Piece')
	expect(calls[0]!.body).not.toHaveProperty('series_id')
})

test('releases come back newest first', async () => {
	const older = {
		record: { ...liveRelease.record, id: 1, release_date: '2007-08-18' },
	}
	const newer = {
		record: { ...liveRelease.record, id: 2, release_date: '2026-07-26' },
	}
	const { impl } = stubFetch({ results: [older, newer] })
	const releases = await fetchMangaUpdatesReleases(impl, 'One Piece', {
		approvalRef: APPROVAL,
	})
	expect(releases.map(release => release.sourceKey)).toEqual([
		'release:2',
		'release:1',
	])
})

test('a provider error is surfaced rather than treated as no releases', async () => {
	const { impl } = stubFetch({}, false, 503)
	await expect(
		fetchMangaUpdatesReleases(impl, 'One Piece', { approvalRef: APPROVAL }),
	).rejects.toThrow(/503/)
})
