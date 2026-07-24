import { expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'
import { action } from './home-memory-search.ts'

test('anonymous home memory search returns grounded catalog matches without AI', async () => {
	const matches = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Amber Lighthouse ${index + 1}`,
					description:
						'A keeper finds an amber journal inside an isolated lighthouse.',
					catalogPopularity: 100 - index,
				},
			}),
		),
	)
	vi.stubEnv('OPENAI_API_KEY', 'configured-key')
	const fetchMock = vi.fn<typeof fetch>()
	vi.stubGlobal('fetch', fetchMock)
	const formData = new FormData()
	formData.set(
		'q',
		'an isolated lighthouse where the keeper finds an amber journal',
	)
	formData.set('kind', 'movie')

	const response = await action({
		request: new Request(`${BASE_URL}/resources/home-memory-search`, {
			method: 'POST',
			body: formData,
		}),
		params: {},
	} as any)

	expect(response.data.ok).toBe(true)
	if (!response.data.ok) throw new Error(response.data.error)
	expect(fetchMock).not.toHaveBeenCalled()
	expect(response.data.items).toHaveLength(5)
	expect(response.data.items.map(item => item.id)).toEqual(
		expect.arrayContaining(matches.map(item => item.id)),
	)
	expect(response.data.items[0]?.memoryMatch).toEqual(
		expect.objectContaining({
			matchedClues: expect.arrayContaining([
				'isolated',
				'lighthouse',
				'journal',
			]),
		}),
	)
})

test('anonymous home memory search validates short prompts', async () => {
	const formData = new FormData()
	formData.set('q', 'no')
	formData.set('kind', 'all')

	const response = await action({
		request: new Request(`${BASE_URL}/resources/home-memory-search`, {
			method: 'POST',
			body: formData,
		}),
		params: {},
	} as any)

	expect(response.data).toEqual({
		ok: false,
		error: 'Add at least three characters.',
	})
})
