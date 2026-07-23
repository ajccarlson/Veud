import { expect, test } from 'vitest'
import {
	consolidateLibraryImportItems,
	parseJsonLibraryExport,
	parseLetterboxdCsv,
	parseMyAnimeListXml,
} from './library-import.ts'

test('normalizes MAL anime and manga XML without user-generated content', () => {
	const items = parseMyAnimeListXml(`
		<myanimelist>
			<anime>
				<series_animedb_id>1</series_animedb_id>
				<series_title><![CDATA[Cowboy Bebop &amp; Friends]]></series_title>
				<my_status>Completed</my_status><my_score>9</my_score>
				<my_watched_episodes>26</my_watched_episodes>
				<my_times_watched>2</my_times_watched>
				<my_start_date>2020-01-01</my_start_date>
				<my_finish_date>2020-02-01</my_finish_date>
			</anime>
			<manga>
				<manga_mangadb_id>2</manga_mangadb_id>
				<manga_title>Berserk</manga_title><my_status>Reading</my_status>
				<my_read_chapters>100</my_read_chapters>
				<my_read_volumes>12</my_read_volumes>
			</manga>
		</myanimelist>
	`)
	expect(items).toHaveLength(2)
	expect(items[0]).toEqual(
		expect.objectContaining({
			externalId: '1',
			externalProvider: 'mal',
			title: 'Cowboy Bebop & Friends',
			status: 'completed',
			score: 9,
			progress: { episodes: 26 },
			repeatCount: 2,
		}),
	)
	expect(items[1]).toEqual(
		expect.objectContaining({
			mediaKind: 'manga',
			status: 'current',
			progress: { chapters: 100, volumes: 12 },
		}),
	)
})

test('consolidates repeated history rows into one import decision', () => {
	const rows = parseLetterboxdCsv(
		'Date,Name,Year,Letterboxd URI,Rating,Rewatch\n' +
			'2024-01-01,Arrival,2016,https://letterboxd.com/film/arrival/,4,No\n' +
			'2025-01-01,Arrival,2016,https://letterboxd.com/film/arrival/,4.5,Yes\n',
	)
	const items = consolidateLibraryImportItems(rows)
	expect(items).toHaveLength(1)
	expect(items[0]).toEqual(
		expect.objectContaining({
			title: 'Arrival',
			score: 9,
			repeatCount: 1,
			completedAt: '2025-01-01T00:00:00.000Z',
		}),
	)
})

test('parses quoted Letterboxd CSV and converts five-star ratings', () => {
	const [item] = parseLetterboxdCsv(
		'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Watched Date\r\n' +
			'2026-01-02,"Once Upon a Time, in Hollywood",2019,https://letterboxd.com/film/once-upon-a-time-in-hollywood/,4.5,Yes,2026-01-01\r\n',
	)
	expect(item).toEqual(
		expect.objectContaining({
			title: 'Once Upon a Time, in Hollywood',
			externalId: 'once-upon-a-time-in-hollywood',
			score: 9,
			repeatCount: 1,
			status: 'completed',
		}),
	)
})

test('normalizes AniList and Trakt JSON variants', () => {
	const [anime] = parseJsonLibraryExport(
		'anilist',
		JSON.stringify({
			lists: [
				{
					entries: [
						{
							status: 'CURRENT',
							score: 85,
							progress: 7,
							media: {
								id: 20,
								type: 'ANIME',
								title: { romaji: 'Naruto' },
							},
						},
					],
				},
			],
		}),
	)
	expect(anime).toEqual(
		expect.objectContaining({
			title: 'Naruto',
			status: 'current',
			score: 8.5,
			progress: { episodes: 7 },
		}),
	)

	const [movie] = parseJsonLibraryExport(
		'trakt',
		JSON.stringify([
			{
				rating: 8,
				watched_at: '2024-04-05T00:00:00Z',
				movie: { title: 'Arrival', ids: { trakt: 123, tmdb: 329865 } },
			},
		]),
	)
	expect(movie).toEqual(
		expect.objectContaining({
			mediaKind: 'movie',
			title: 'Arrival',
			externalId: '329865',
			externalProvider: 'tmdb',
			score: 8,
			status: 'completed',
		}),
	)
})

test('uses MAL identity from AniList and treats repeating as current', () => {
	const [anime] = parseJsonLibraryExport(
		'anilist',
		JSON.stringify({
			entries: [
				{
					status: 'REPEATING',
					media: {
						id: 1,
						idMal: 5114,
						type: 'ANIME',
						title: { english: 'Fullmetal Alchemist: Brotherhood' },
					},
				},
			],
		}),
	)
	expect(anime).toEqual(
		expect.objectContaining({
			externalId: '5114',
			externalProvider: 'mal',
			status: 'current',
		}),
	)
})

test('treats an undated Letterboxd watchlist row as planning', () => {
	const [item] = parseLetterboxdCsv(
		'Position,Name,Year,Letterboxd URI\n1,Arrival,2016,https://letterboxd.com/film/arrival/\n',
	)
	expect(item).toEqual(
		expect.objectContaining({
			status: 'planning',
			completedAt: null,
		}),
	)
})
