import { expect, test } from 'vitest'
import {
	assertRequiredQueryIndexes,
	assertSafeLoadDatabaseUrl,
	bytesLabel,
	calendarLoadWindow,
	representativeLoadShape,
	summarizeDatabasePressure,
	summarizeExplain,
	validateLoadCheckpoint,
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

test('requires every measured search to use the index assigned to its query', () => {
	expect(() =>
		assertRequiredQueryIndexes(
			[
				{
					name: 'canonical-title',
					indexes: ['Media_title_trgm_idx'],
				},
				{
					name: 'canonical-title',
					indexes: ['Media_title_trgm_idx'],
				},
				{
					name: 'alternate-title',
					indexes: ['MediaTitle_normalized_trgm_idx'],
				},
				{
					name: 'rare-description',
					indexes: ['Media_description_trgm_idx'],
				},
			],
			{
				'canonical-title': 'Media_title_trgm_idx',
				'alternate-title': 'MediaTitle_normalized_trgm_idx',
				'rare-description': 'Media_description_trgm_idx',
			},
		),
	).not.toThrow()
})

test('does not accept a required index used only by the wrong query', () => {
	const requirements = {
		'canonical-title': 'Media_title_trgm_idx',
		'alternate-title': 'MediaTitle_normalized_trgm_idx',
		'rare-description': 'Media_description_trgm_idx',
	}
	const plans = [
		{
			name: 'canonical-title',
			indexes: ['MediaTitle_normalized_trgm_idx'],
		},
		{
			name: 'alternate-title',
			indexes: ['Media_description_trgm_idx'],
		},
		{
			name: 'rare-description',
			indexes: ['Media_title_trgm_idx'],
		},
	]

	let failure
	try {
		assertRequiredQueryIndexes(plans, requirements)
	} catch (error) {
		failure = error
	}

	expect(failure).toBeInstanceOf(Error)
	expect(failure.message).toContain('canonical-title -> Media_title_trgm_idx')
	expect(failure.missingRequirements).toEqual([
		expect.objectContaining({
			queryName: 'canonical-title',
			requiredIndex: 'Media_title_trgm_idx',
		}),
		expect.objectContaining({
			queryName: 'alternate-title',
			requiredIndex: 'MediaTitle_normalized_trgm_idx',
		}),
		expect.objectContaining({
			queryName: 'rare-description',
			requiredIndex: 'Media_description_trgm_idx',
		}),
	])
})

test('rejects an unmeasured required query and a partial duplicate measurement', () => {
	expect(() =>
		assertRequiredQueryIndexes(
			[
				{
					name: 'canonical-title',
					indexes: ['Media_title_trgm_idx'],
				},
				{
					name: 'canonical-title',
					indexes: [],
				},
			],
			{
				'canonical-title': 'Media_title_trgm_idx',
				'alternate-title': 'MediaTitle_normalized_trgm_idx',
			},
		),
	).toThrow(/1\/2 measurements missing.*alternate-title/s)
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
		publicListTrackingRows: 2_420,
		privateListTrackingRows: 330,
		nullListTrackingRows: 250,
		entryRows: 3_000,
		activityPerMember: 15,
		activityRows: 375,
		relationRows: 99,
		feedRows: 10,
		nextReleaseRows: 50,
		releaseOccurrenceRows: 40,
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
			publicListTrackingRows: 16,
			privateListTrackingRows: 0,
			nullListTrackingRows: 0,
			activityPerMember: 8,
			activityRows: 16,
			nextReleaseRows: 0,
			releaseOccurrenceRows: 0,
		}),
	)
})

test('requires each bounded calendar query to use its assigned index', () => {
	const requirements = {
		'calendar-media-range': 'Media_nextReleaseAt_idx',
		'calendar-occurrence-range': 'ReleaseOccurrence_releaseAt_status_idx',
		'calendar-public-tracker-counts': 'TrackingState_mediaId_idx',
	}
	const plans = [
		{
			name: 'calendar-media-range',
			indexes: ['Media_nextReleaseAt_idx'],
		},
		{
			name: 'calendar-occurrence-range',
			indexes: ['ReleaseOccurrence_releaseAt_status_idx'],
		},
		{
			name: 'calendar-public-tracker-counts',
			indexes: ['TrackingState_mediaId_idx', 'Watchlist_pkey'],
		},
	]

	expect(() => assertRequiredQueryIndexes(plans, requirements)).not.toThrow()
	expect(() =>
		assertRequiredQueryIndexes(
			plans.map((plan, index) => ({
				...plan,
				indexes: plans[(index + 1) % plans.length].indexes,
			})),
			requirements,
		),
	).toThrow(/calendar-media-range -> Media_nextReleaseAt_idx/)
})

test('derives a deterministic calendar window from the persisted load anchor', () => {
	const window = calendarLoadWindow('2026-07-28T12:30:00.000Z')
	expect(window).toEqual({
		reference: new Date('2026-07-28T12:30:00.000Z'),
		start: new Date('2026-07-27T12:30:00.000Z'),
		end: new Date('2026-08-05T12:30:00.000Z'),
	})
	expect(() => calendarLoadWindow('not-a-timestamp')).toThrow(
		/calendar load anchor/,
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

test('validates target-bound resumable load checkpoints', () => {
	const expected = {
		target: 'db.example:5432/veud_staging',
		requestedRows: 2_000,
		memberCount: 20,
		trackingPerMember: 50,
		activityPerMember: 10,
	}
	const checkpoint = {
		version: 1,
		status: 'interrupted',
		...expected,
		initialRows: 0,
		loadedRows: 1_000,
		batchesCompleted: 2,
		insertWallMs: 125.5,
		storageBefore: { databaseBytes: 1_000_000 },
		startedAt: '2026-07-20T10:00:00.000Z',
		updatedAt: '2026-07-20T10:01:00.000Z',
		interruptedAt: '2026-07-20T10:01:00.000Z',
	}
	expect(validateLoadCheckpoint(checkpoint, expected)).toBe(checkpoint)
	expect(() =>
		validateLoadCheckpoint(checkpoint, { ...expected, memberCount: 21 }),
	).toThrow('memberCount changed')
})

test('summarizes peak connection and lock pressure', () => {
	expect(
		summarizeDatabasePressure([
			{
				maxConnections: 100,
				totalConnections: 8,
				activeConnections: 5,
				waitingLocks: 0,
			},
			{
				maxConnections: 100,
				totalConnections: 12,
				activeConnections: 9,
				waitingLocks: 2,
			},
		]),
	).toEqual({
		sampleCount: 2,
		maxConnections: 100,
		peakTotalConnections: 12,
		peakActiveConnections: 9,
		peakWaitingLocks: 2,
		peakConnectionUtilization: 0.12,
	})
})
