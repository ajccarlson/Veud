import { z } from 'zod'

export const serviceAreas = [
	'website',
	'accounts',
	'lists',
	'catalog',
	'search',
	'notifications',
] as const

export const incidentSeverities = ['minor', 'major', 'critical'] as const
export const incidentStatuses = [
	'investigating',
	'identified',
	'monitoring',
	'resolved',
] as const

export const createIncidentSchema = z.object({
	title: z.string().trim().min(3).max(120),
	summary: z.string().trim().min(3).max(1000),
	severity: z.enum(incidentSeverities),
	affectedAreas: z.array(z.enum(serviceAreas)).min(1).max(serviceAreas.length),
})

export const updateIncidentSchema = z.object({
	incidentId: z.string().trim().min(1),
	status: z.enum(incidentStatuses),
	message: z.string().trim().min(3).max(1000),
})

export function parseAffectedAreas(value: string) {
	try {
		const parsed: unknown = JSON.parse(value)
		const result = z.array(z.enum(serviceAreas)).safeParse(parsed)
		return result.success ? [...new Set(result.data)] : []
	} catch {
		return []
	}
}

export function incidentStatusLabel(value: string) {
	return value
		.split('-')
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}
