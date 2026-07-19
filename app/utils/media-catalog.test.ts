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
			personal: 9,
			notes: 'Private note',
			history: '{"started":true}',
			ownerId: 'user-1',
		}),
	).toEqual({
		title: 'Shared title',
		thumbnail: 'poster|provider',
		description: 'Shared synopsis',
	})
})

test('canonical media fields override a legacy snapshot without erasing fallbacks', () => {
	expect(
		resolveMediaCatalog(
			{ title: 'Canonical title', description: 'Canonical synopsis' },
			{
				title: 'Legacy title',
				description: 'Legacy synopsis',
				length: '12 eps',
			},
		),
	).toEqual({
		title: 'Canonical title',
		description: 'Canonical synopsis',
		length: '12 eps',
	})
})
