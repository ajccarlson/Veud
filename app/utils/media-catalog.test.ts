import { expect, test } from 'vitest'
import {
	catalogDataFromSnapshot,
	resolveMediaCatalog,
} from './media-catalog.ts'

test('catalog snapshots exclude user-specific tracking data', () => {
	expect(
		catalogDataFromSnapshot({
			title: 'Shared title',
			thumbnail: 'poster|provider',
			description: 'Shared synopsis',
			videos: '[{"provider":"tmdb"}]',
			personal: 9,
			notes: 'Private note',
			history: '{"started":true}',
			ownerId: 'user-1',
		}),
	).toEqual({
		title: 'Shared title',
		thumbnail: 'poster|provider',
		description: 'Shared synopsis',
		videos: '[{"provider":"tmdb"}]',
	})
})

test('catalog resolution returns only populated canonical media fields', () => {
	expect(
		resolveMediaCatalog({
			title: 'Canonical title',
			description: 'Canonical synopsis',
			length: null,
		}),
	).toEqual({
		title: 'Canonical title',
		description: 'Canonical synopsis',
	})
})
