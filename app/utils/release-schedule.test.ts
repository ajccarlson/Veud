import { expect, test } from 'vitest'
import { serializeNextRelease } from './release-schedule.ts'

test('distinguishes an authoritative empty schedule from a failed refresh', () => {
	expect(serializeNextRelease(null)).toBeNull()
	expect(serializeNextRelease(undefined)).toBeUndefined()
	expect(
		serializeNextRelease({
			source: 'tmdb',
			observedAt: '2026-07-20T12:00:00.000Z',
			releaseDate: '2026-07-27',
			episode: 4,
		}),
	).toBe(
		JSON.stringify({
			source: 'tmdb',
			observedAt: '2026-07-20T12:00:00.000Z',
			releaseDate: '2026-07-27',
			episode: 4,
		}),
	)
})
