import { expect, test } from 'vitest'
import { activityEventLabel, activityListTypeName } from './activity.ts'

test('formats status and rating events', () => {
	expect(
		activityEventLabel({
			type: 'status',
			status: 'watching',
			statusLabel: 'Watching',
		}),
	).toBe('Added to Watching')
	expect(
		activityEventLabel({
			type: 'status',
			status: 'completed',
			statusLabel: 'Completed',
			previousStatus: 'watching',
			previousStatusLabel: 'Watching',
		}),
	).toBe('Moved from Watching to Completed')
	expect(activityEventLabel({ type: 'score', score: 8.5 })).toBe(
		'Rated 8.5/10',
	)
	expect(activityEventLabel({ type: 'score', score: null })).toBe(
		'Removed rating',
	)
})

test('formats progress ranges and corrections', () => {
	expect(
		activityEventLabel({
			type: 'progress',
			progressUnit: 'episode',
			progressPrevious: 2,
			progressCurrent: 3,
		}),
	).toBe('Watched episode 3')
	expect(
		activityEventLabel({
			type: 'progress',
			progressUnit: 'chapter',
			progressPrevious: 3,
			progressCurrent: 7,
		}),
	).toBe('Read chapters 4–7')
	expect(
		activityEventLabel({
			type: 'progress',
			progressUnit: 'volume',
			progressPrevious: 4,
			progressCurrent: 2,
		}),
	).toBe('Set volume progress to 2')
})

test('maps canonical kinds to profile list types', () => {
	expect(activityListTypeName('movie')).toBe('liveaction')
	expect(activityListTypeName('tv')).toBe('liveaction')
	expect(activityListTypeName('anime')).toBe('anime')
	expect(activityListTypeName('manga')).toBe('manga')
	expect(activityListTypeName('game')).toBeNull()
})
