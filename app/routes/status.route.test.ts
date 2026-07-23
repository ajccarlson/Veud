import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { loader } from './status.tsx'

test('returns active and recent resolved incidents without operator identities', async () => {
	const active = await prisma.serviceIncident.create({
		data: {
			title: 'Search delays',
			summary: 'Some searches are taking longer than normal.',
			severity: 'minor',
			affectedAreas: JSON.stringify(['search']),
			events: {
				create: {
					status: 'investigating',
					message: 'The operations team is investigating.',
				},
			},
		},
	})
	const response = await loader({} as any)
	expect(response.init?.headers).toEqual(
		expect.objectContaining({ 'Cache-Control': 'no-store' }),
	)
	expect(response.data.incidents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: active.id,
				affectedAreas: ['search'],
				events: [
					expect.objectContaining({
						status: 'investigating',
					}),
				],
			}),
		]),
	)
	expect(JSON.stringify(response.data)).not.toContain('actorId')
})
