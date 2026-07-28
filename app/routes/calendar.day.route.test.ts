import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'
import { loader } from './calendar.$day.tsx'

test('day page lists every release for the day in schedule order', async () => {
	await Promise.all(
		['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(letter =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title: `Full Day ${letter}`,
					releaseStart: new Date('2026-07-21T00:00:00.000Z'),
				},
			}),
		),
	)

	const result = await loader({
		request: new Request(`${BASE_URL}/calendar/2026-07-21?week=2026-07-20`),
		params: { day: '2026-07-21' },
	} as any)

	expect(result.data.day).toBe('2026-07-21')
	expect(result.data.weekStart).toBe('2026-07-20')
	expect(result.data.days).toHaveLength(1)
	const titles = result.data.days[0]!.items.map(item => item.title)
	expect(titles).toEqual(
		['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(letter => `Full Day ${letter}`),
	)
	expect(result.data.days[0]!.totalCount).toBe(7)
	expect(result.data.previousStart).toBe('2026-07-20')
	expect(result.data.nextStart).toBe('2026-07-22')
})

test('day page rejects malformed dates', async () => {
	await expect(
		loader({
			request: new Request(`${BASE_URL}/calendar/not-a-day`),
			params: { day: 'not-a-day' },
		} as any),
	).rejects.toMatchObject({ status: 404 })
})
