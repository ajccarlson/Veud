import { expect, test } from 'vitest'
import {
	mediaVideoLinks,
	normalizeTmdbVideos,
	serializeMediaVideos,
} from './media-videos.ts'

test('prefers official trailers, deduplicates destinations, and stays bounded', () => {
	const videos = normalizeTmdbVideos({
		results: [
			{
				site: 'YouTube',
				key: 'feature_123',
				name: 'Featurette',
				type: 'Featurette',
				official: true,
			},
			{
				site: 'YouTube',
				key: 'trailer_123',
				name: 'Official trailer',
				type: 'Trailer',
				official: true,
				published_at: '2026-05-01T00:00:00Z',
			},
			{
				site: 'YouTube',
				key: 'trailer_123',
				name: 'Duplicate',
				type: 'Trailer',
			},
			...Array.from({ length: 10 }, (_, index) => ({
				site: 'Vimeo',
				key: String(1_000_000 + index),
				name: `Clip ${index}`,
				type: 'Clip',
			})),
		],
	})

	expect(videos).toHaveLength(8)
	expect(videos[0]).toMatchObject({
		name: 'Official trailer',
		site: 'youtube',
		publishedAt: '2026-05-01T00:00:00.000Z',
	})
	expect(videos.filter(video => video.key === 'trailer_123')).toHaveLength(1)
})

test('rejects unsafe provider destinations and revalidates persisted JSON', () => {
	const videos = normalizeTmdbVideos({
		results: [
			{ site: 'EvilTube', key: 'trailer_123', name: 'No', type: 'Trailer' },
			{ site: 'YouTube', key: '../escape', name: 'No', type: 'Trailer' },
			{ site: 'Vimeo', key: '1234567', name: 'Safe clip', type: 'Clip' },
		],
	})
	expect(videos).toHaveLength(1)

	const links = mediaVideoLinks(serializeMediaVideos(videos))
	expect(links).toEqual([
		expect.objectContaining({
			url: 'https://vimeo.com/1234567',
			thumbnailUrl: null,
		}),
	])
	expect(
		mediaVideoLinks(
			JSON.stringify([
				{ provider: 'other', site: 'youtube', key: 'abcdefghi12', name: 'No' },
			]),
		),
	).toEqual([])
	expect(mediaVideoLinks('{not json')).toEqual([])
})
