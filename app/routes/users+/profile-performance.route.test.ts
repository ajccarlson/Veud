import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { loader as overviewLoader } from '#app/routes/users+/$username.index.tsx'
import {
	loader as profileLoader,
	shouldRevalidate,
} from '#app/routes/users+/$username.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'

test('profile tab navigation keeps the stable shell without blocking explicit refreshes', () => {
	const base = {
		currentParams: { username: 'sample' },
		nextParams: { username: 'sample' },
		currentUrl: new URL(`${BASE_URL}/users/sample`),
		nextUrl: new URL(`${BASE_URL}/users/sample/reviews`),
		defaultShouldRevalidate: true,
	} as any

	expect(shouldRevalidate(base)).toBe(false)
	expect(
		shouldRevalidate({
			...base,
			nextParams: { username: 'another-member' },
		}),
	).toBe(true)
	expect(
		shouldRevalidate({
			...base,
			nextUrl: base.currentUrl,
		}),
	).toBe(true)
})

test('profile shell and analytics stay within representative payload budgets', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `profile_perf_${suffix}@example.com`,
			username: `profile_perf_${suffix}`,
			bio: 'A representative profile with a substantial tracking history.',
		},
	})
	const listType = await prisma.listType.create({
		data: {
			name: `profile-perf-${suffix}`,
			header: 'Profile performance fixtures',
			columns: JSON.stringify({
				title: 'string',
				length: 'string',
				personal: 'number',
			}),
			mediaType: '["episode"]',
			completionType: '{"past":"watched"}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
		},
	})
	const omittedSentinel = `OMITTED_${suffix}`
	const entries = Array.from({ length: 500 }, (_, index) => ({
		watchlistId: watchlist.id,
		position: index + 1,
		title: `Representative title ${index + 1}`,
		type: 'TV',
		length: `${(index % 24) + 1} / 24 eps`,
		personal: (index % 10) + 1,
		history: JSON.stringify({
			added: Date.UTC(2025, 0, 1) + index,
			lastUpdated: Date.UTC(2025, 0, 1) + index,
		}),
		description: `${omittedSentinel}:${'description '.repeat(180)}`,
		notes: `${omittedSentinel}:${'private note '.repeat(120)}`,
	}))
	for (let index = 0; index < entries.length; index += 100) {
		await prisma.entry.createMany({ data: entries.slice(index, index + 100) })
	}

	const args = {
		request: new Request(`${BASE_URL}/users/${user.username}`),
		params: { username: user.username },
	} as any
	const [shellResult, overviewResult] = await Promise.all([
		profileLoader(args),
		overviewLoader(args),
	])
	const shellPayload = JSON.stringify(shellResult.data)
	const analyticsPayload = JSON.stringify(overviewResult.data)

	expect(Buffer.byteLength(shellPayload)).toBeLessThan(32 * 1024)
	expect(Buffer.byteLength(analyticsPayload)).toBeLessThan(512 * 1024)
	expect(shellPayload).not.toContain('typedEntries')
	expect(analyticsPayload).not.toContain(omittedSentinel)
	expect(new Headers(shellResult.init?.headers).get('Server-Timing')).toContain(
		'profile_shell',
	)
	expect(
		new Headers(overviewResult.init?.headers).get('Server-Timing'),
	).toContain('profile_overview')
})
