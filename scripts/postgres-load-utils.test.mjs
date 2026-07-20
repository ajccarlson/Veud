import { expect, test } from 'vitest'
import {
	assertSafeLoadDatabaseUrl,
	bytesLabel,
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
