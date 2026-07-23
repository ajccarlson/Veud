import { expect, test } from 'vitest'
import {
	createIncidentSchema,
	incidentStatusLabel,
	parseAffectedAreas,
	updateIncidentSchema,
} from './service-incidents.ts'

test('parses only supported service areas', () => {
	expect(parseAffectedAreas('["website","lists","website"]')).toEqual([
		'website',
		'lists',
	])
	expect(parseAffectedAreas('["database"]')).toEqual([])
	expect(parseAffectedAreas('bad json')).toEqual([])
})

test('validates bounded incident creation and updates', () => {
	expect(
		createIncidentSchema.safeParse({
			title: 'Catalog delay',
			summary: 'New titles are arriving slowly.',
			severity: 'minor',
			affectedAreas: ['catalog'],
		}).success,
	).toBe(true)
	expect(
		updateIncidentSchema.safeParse({
			incidentId: 'incident-1',
			status: 'resolved',
			message: 'The backlog is cleared.',
		}).success,
	).toBe(true)
	expect(incidentStatusLabel('investigating')).toBe('Investigating')
})
