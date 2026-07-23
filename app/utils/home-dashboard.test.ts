import { expect, test } from 'vitest'
import {
	DEFAULT_HOME_DASHBOARD_CONFIG,
	normalizeHomeDashboardConfig,
} from './home-dashboard.ts'

test('dashboard configuration repairs malformed, duplicate, and partial data', () => {
	expect(normalizeHomeDashboardConfig()).toEqual(DEFAULT_HOME_DASHBOARD_CONFIG)
	expect(
		normalizeHomeDashboardConfig({
			density: 'compact',
			moduleOrder: JSON.stringify(['library', 'library', 'unknown']),
			collapsedModules: JSON.stringify([
				'following',
				'following',
				'unknown',
			]),
		}),
	).toEqual({
		density: 'compact',
		moduleOrder: [
			'library',
			'trending',
			'continue',
			'recommendations',
			'following',
			'upcoming',
		],
		collapsedModules: ['following'],
	})
	expect(
		normalizeHomeDashboardConfig({
			density: 'unexpected',
			moduleOrder: '{',
			collapsedModules: 'null',
		}),
	).toEqual(DEFAULT_HOME_DASHBOARD_CONFIG)
})
