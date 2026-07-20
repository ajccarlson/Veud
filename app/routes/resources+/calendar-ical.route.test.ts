import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './calendar[.]ics.ts'

async function createViewer() {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const viewer = await prisma.user.create({
		data: {
			email: `ical_${suffix}@example.com`,
			username: `ical_${suffix}`,
		},
	})
	const session = await prisma.session.create({
		data: { userId: viewer.id, expirationDate: getSessionExpirationDate() },
	})
	return { viewer, cookie: await getSessionCookieHeader(session) }
}

test('calendar export returns the selected public week as an iCalendar download', async () => {
	await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'Portable, Public Premiere',
			releaseStart: new Date('2026-07-22T00:00:00.000Z'),
		},
	})
	const response = await loader({
		request: new Request(
			`${BASE_URL}/resources/calendar.ics?start=2026-07-20&kind=movie&scope=all`,
		),
		params: {},
	} as any)
	const body = await response.text()

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toBe(
		'text/calendar; charset=utf-8',
	)
	expect(response.headers.get('content-disposition')).toBe(
		'attachment; filename="veud-releases-2026-07-20.ics"',
	)
	expect(body).toContain('SUMMARY:Portable\\, Public Premiere — Premiere')
	expect(body).toContain('X-WR-TIMEZONE:UTC')
	expect(body).toContain('URL:https://www.epicstack.dev/media/')
})

test('personal calendar exports require a member and include only tracked titles', async () => {
	const { viewer, cookie } = await createViewer()
	const [tracked, untracked] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Tracked Calendar Export',
				nextRelease: JSON.stringify({
					releaseDate: '2026-07-21T18:30:00.000Z',
					episode: 3,
				}),
			},
		}),
		prisma.media.create({
			data: {
				kind: 'anime',
				title: 'Untracked Calendar Export',
				releaseStart: new Date('2026-07-22T00:00:00.000Z'),
			},
		}),
	])
	await prisma.trackingState.create({
		data: {
			ownerId: viewer.id,
			mediaId: tracked.id,
			status: 'watching',
			score: 9,
		},
	})
	const exportUrl = `${BASE_URL}/resources/calendar.ics?start=2026-07-20&kind=anime&scope=mine`

	let redirectResponse: unknown
	try {
		await loader({
			request: new Request(exportUrl),
			params: {},
		} as any)
	} catch (error) {
		redirectResponse = error
	}
	expect(redirectResponse).toBeInstanceOf(Response)
	expect((redirectResponse as Response).status).toBe(302)
	expect((redirectResponse as Response).headers.get('location')).toContain(
		'/login?redirectTo=',
	)

	const response = await loader({
		request: new Request(exportUrl, { headers: { cookie } }),
		params: {},
	} as any)
	const body = await response.text()
	expect(body).toContain('Tracked Calendar Export')
	expect(body).toContain('Watching · 9/10')
	expect(body).not.toContain('Untracked Calendar Export')
	expect(response.headers.get('cache-control')).toBe('private, no-store')

	await prisma.media.deleteMany({
		where: { id: { in: [tracked.id, untracked.id] } },
	})
})
