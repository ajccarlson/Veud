import { faker } from '@faker-js/faker'
import { expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import {
	getDiscoveryResults,
	resetViewerDiscoveryTasteCacheForTest,
} from './discovery.server.ts'

async function viewerWithLibrary(
	entries: number,
	genres = 'Adventure, Comedy',
) {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const user = await prisma.user.create({
		data: { email: `taste_${tag}@example.com`, username: `taste_${tag}` },
	})
	const media = await Promise.all(
		Array.from({ length: entries }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'anime',
					title: `Taste ${tag} ${index}`,
					genres,
				},
			}),
		),
	)
	await Promise.all(
		media.map(entry =>
			prisma.trackingState.create({
				data: {
					ownerId: user.id,
					mediaId: entry.id,
					status: 'completed',
					score: 9,
				},
			}),
		),
	)
	return { user, media }
}

test('the taste scan runs once until the library changes', async () => {
	// Computing taste reads every tracking state joined to media for its genres,
	// to produce five labels. That ran on every for-you request.
	resetViewerDiscoveryTasteCacheForTest()
	const { user, media } = await viewerWithLibrary(3)
	const findMany = vi.spyOn(prisma.trackingState, 'findMany')

	const query = {
		q: '',
		kind: 'all',
		mode: 'standard',
		genre: '',
		year: null,
		status: '',
		provider: 'all',
		sort: 'for-you',
		page: 1,
	} as const

	await getDiscoveryResults(query as never, user.id)
	const afterFirst = findMany.mock.calls.length
	expect(afterFirst).toBeGreaterThan(0)

	await getDiscoveryResults(query as never, user.id)
	await getDiscoveryResults(query as never, user.id)
	expect(findMany.mock.calls.length).toBe(afterFirst)

	// A change to the library is reflected on the next request, not whenever a
	// timer happens to expire.
	await prisma.trackingState.update({
		where: { ownerId_mediaId: { ownerId: user.id, mediaId: media[0]!.id } },
		data: { score: 3 },
	})
	await getDiscoveryResults(query as never, user.id)
	expect(findMany.mock.calls.length).toBeGreaterThan(afterFirst)
	findMany.mockRestore()
})

test('one viewer cache entry is never served to another viewer', async () => {
	resetViewerDiscoveryTasteCacheForTest()
	// Deliberately different tastes: if one viewer's cached entry were served to
	// the other, the labels would be identical and the mix-up invisible.
	const [first, second] = await Promise.all([
		viewerWithLibrary(2, 'Horror'),
		viewerWithLibrary(2, 'Romance'),
	])
	const query = {
		q: '',
		kind: 'all',
		mode: 'standard',
		genre: '',
		year: null,
		status: '',
		provider: 'all',
		sort: 'for-you',
		page: 1,
	} as const
	const a = await getDiscoveryResults(query as never, first.user.id)
	const b = await getDiscoveryResults(query as never, second.user.id)
	expect(a.preferredGenres).toEqual(['Horror'])
	expect(b.preferredGenres).toEqual(['Romance'])
})
