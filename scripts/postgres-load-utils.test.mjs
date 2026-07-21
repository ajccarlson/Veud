import { expect, test } from 'vitest'
import {
	assertSafeLoadDatabaseUrl,
	bytesLabel,
	representativeLoadShape,
	summarizeExplain,
} from './postgres-load-utils.mjs'

test('permits only clearly non-production PostgreSQL load targets', () => {
	expect(() => assertSafeLoadDatabaseUrl('file:./test.db')).toThrow(
		'must use postgresql://',
	)
	expect(() =>
		assertSafeLoadDatabaseUrl('postgresql://veud@db.example/veud'),
	).toThrow('Load-test database name')
	expect(() =>
		assertSafeLoadDatabaseUrl('postgresql://veud@db.example/veud-contest'),
	).toThrow('Load-test database name')
	expect(
		assertSafeLoadDatabaseUrl(
			'postgresql://veud:secret@DB.EXAMPLE:5433/veud_load_test',
		),
	).toEqual({
		host: 'db.example',
		port: '5433',
		database: 'veud_load_test',
		identity: 'db.example:5433/veud_load_test',
	})
})

test('summarizes nested explain plans without credentials or raw SQL', () => {
	expect(
		summarizeExplain([
			{
				'QUERY PLAN': [
					{
						'Planning Time': 0.5,
						'Execution Time': 2.25,
						Plan: {
							'Node Type': 'Limit',
							'Actual Rows': 24,
							Plans: [
								{
									'Node Type': 'Bitmap Index Scan',
									'Index Name': 'Media_title_trgm_idx',
									'Shared Hit Blocks': 8,
								},
							],
						},
					},
				],
			},
		]),
	).toEqual({
		planningMs: 0.5,
		executionMs: 2.25,
		actualRows: 24,
		nodeTypes: ['Limit', 'Bitmap Index Scan'],
		indexes: ['Media_title_trgm_idx'],
		sharedHitBlocks: 8,
		sharedReadBlocks: 0,
	})
	expect(bytesLabel(1_048_576)).toBe('1.00 MiB')
})

test('derives a bounded representative catalog and member load shape', () => {
	expect(
		representativeLoadShape({
			mediaCount: 1_000,
			memberCount: 25,
			trackingPerMember: 120,
			activityPerMember: 15,
		}),
	).toEqual({
		memberCount: 25,
		watchlistRows: 75,
		trackingPerMember: 120,
		trackingRows: 3_000,
		entryRows: 3_000,
		activityPerMember: 15,
		activityRows: 375,
		relationRows: 99,
		feedRows: 10,
	})

	expect(
		representativeLoadShape({
			mediaCount: 8,
			memberCount: 2,
			trackingPerMember: 100,
			activityPerMember: 20,
		}),
	).toEqual(
		expect.objectContaining({
			trackingPerMember: 8,
			trackingRows: 16,
			activityPerMember: 8,
			activityRows: 16,
		}),
	)
})

test('rejects unsafe representative member row counts', () => {
	expect(() =>
		representativeLoadShape({
			mediaCount: 100_000,
			memberCount: 100_000,
			trackingPerMember: 100,
		}),
	).toThrow('may not exceed 5,000,000 tracking rows')
})
