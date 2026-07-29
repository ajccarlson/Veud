import { expect, test } from 'vitest'
import { availableHomeDashboardModules } from './home-dashboard.tsx'

test('omits unavailable dashboard modules from content and settings', () => {
	expect(
		availableHomeDashboardModules(
			[
				'trending',
				'continue',
				'recommendations',
				'following',
				'library',
				'upcoming',
			],
			{
				trending: 'Trending',
				continue: 'Continue',
				recommendations: 'Recommendations',
				following: 'Following',
				library: null,
				upcoming: null,
			},
		),
	).toEqual(['trending', 'continue', 'recommendations', 'following'])
})
