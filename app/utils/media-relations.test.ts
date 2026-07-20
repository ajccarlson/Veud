import { expect, test } from 'vitest'
import {
	inverseMediaRelationType,
	mediaRelationLabel,
	parseMediaRelationCandidates,
} from './media-relations.ts'

const sourceIdentity = {
	provider: 'mal' as const,
	kind: 'anime' as const,
	externalId: '5114',
}

test('normalizes provider relation names and preserves canonical target snapshots', () => {
	expect(
		parseMediaRelationCandidates(
			[
				{
					relationType: 'Side Story',
					targetIdentity: {
						provider: 'mal',
						kind: 'manga',
						externalId: '25',
					},
					targetCatalog: { title: 'A related manga' },
				},
			],
			sourceIdentity,
		),
	).toEqual([
		expect.objectContaining({
			relationType: 'side_story',
			targetCatalog: { title: 'A related manga' },
		}),
	])
})

test('maps directional relation labels from the current title perspective', () => {
	expect(inverseMediaRelationType('sequel')).toBe('prequel')
	expect(inverseMediaRelationType('side_story')).toBe('parent_story')
	expect(inverseMediaRelationType('adaptation')).toBe('source_material')
	expect(inverseMediaRelationType('alternative_version')).toBe(
		'alternative_version',
	)
	expect(mediaRelationLabel('spin_off')).toBe('Spin-off')
})

test('rejects cross-provider and unknown relation metadata', () => {
	expect(() =>
		parseMediaRelationCandidates(
			[
				{
					relationType: 'sequel',
					targetIdentity: {
						provider: 'tmdb',
						kind: 'tv',
						externalId: '1399',
					},
				},
			],
			sourceIdentity,
		),
	).toThrow(Response)
	expect(() =>
		parseMediaRelationCandidates(
			[
				{
					relationType: 'user-invented-relation',
					targetIdentity: {
						provider: 'mal',
						kind: 'anime',
						externalId: '1',
					},
				},
			],
			sourceIdentity,
		),
	).toThrow(Response)
})

test('limits TMDB relation snapshots to collection franchises', () => {
	const tmdbSource = {
		provider: 'tmdb' as const,
		kind: 'movie' as const,
		externalId: '10',
	}
	expect(
		parseMediaRelationCandidates(
			[
				{
					relationType: 'franchise',
					targetIdentity: {
						provider: 'tmdb',
						kind: 'movie',
						externalId: '11',
					},
				},
			],
			tmdbSource,
		),
	).toEqual([expect.objectContaining({ relationType: 'franchise' })])
	expect(() =>
		parseMediaRelationCandidates(
			[
				{
					relationType: 'sequel',
					targetIdentity: {
						provider: 'tmdb',
						kind: 'movie',
						externalId: '11',
					},
				},
			],
			tmdbSource,
		),
	).toThrow(Response)
})
