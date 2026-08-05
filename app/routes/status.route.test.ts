import { expect, test, vi } from 'vitest'
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

test('an ongoing incident leads the status page, whichever database is behind it', async () => {
	// resolvedAt is null while an incident is ongoing, and SQLite and PostgreSQL
	// disagree about where NULLs sort ascending. Unpinned, production buried
	// active incidents beneath resolved ones — the opposite of the point.
	const [resolved, ongoing] = await Promise.all([
		prisma.serviceIncident.create({
			data: {
				title: 'Resolved incident',
				summary: 'This one is over.',
				severity: 'minor',
				status: 'resolved',
				startedAt: new Date('2026-08-01T00:00:00.000Z'),
				resolvedAt: new Date('2026-08-01T01:00:00.000Z'),
			},
		}),
		prisma.serviceIncident.create({
			data: {
				title: 'Ongoing incident',
				summary: 'This one is happening now.',
				severity: 'major',
				status: 'investigating',
				startedAt: new Date('2026-08-02T00:00:00.000Z'),
				resolvedAt: null,
			},
		}),
	])
	const response = await loader({} as any)
	const incidents = (response as any).data.incidents as Array<{ id: string }>
	const positions = incidents.map(incident => incident.id)
	expect(positions.indexOf(ongoing.id)).toBeGreaterThanOrEqual(0)
	expect(positions.indexOf(ongoing.id)).toBeLessThan(
		positions.indexOf(resolved.id),
	)
})

test('the incident ordering is pinned, not inherited from the database', async () => {
	// SQLite happens to sort NULLs first ascending, which is the order this page
	// wants, so a SQLite test cannot tell a pinned ordering from an inherited
	// one. PostgreSQL sorts them last and buries active incidents. Asserting the
	// query itself is what distinguishes the two.
	const findMany = vi
		.spyOn(prisma.serviceIncident, 'findMany')
		.mockResolvedValue([])
	try {
		await loader({} as any)
		const [args] = findMany.mock.calls[0] ?? []
		expect((args as any)?.orderBy?.[0]).toEqual({
			resolvedAt: { sort: 'asc', nulls: 'first' },
		})
	} finally {
		findMany.mockRestore()
	}
})
