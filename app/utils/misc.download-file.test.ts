import { afterEach, expect, test, vi } from 'vitest'
import { downloadFile } from './misc.tsx'

afterEach(() => vi.unstubAllGlobals())

test('downloads a bounded provider image with verified contents', async () => {
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			{
				status: 200,
				headers: {
					'Content-Type': 'image/png',
					'Content-Length': '8',
				},
			},
		),
	)
	vi.stubGlobal('fetch', fetchMock)

	const result = await downloadFile(
		'https://avatars.githubusercontent.com/u/123?v=4',
	)
	expect(result.contentType).toBe('image/png')
	expect(result.blob.byteLength).toBe(8)
	expect(fetchMock).toHaveBeenCalledWith(
		expect.objectContaining({ hostname: 'avatars.githubusercontent.com' }),
		expect.objectContaining({ redirect: 'manual' }),
	)
})

test('rejects arbitrary hosts before making a request', async () => {
	const fetchMock = vi.fn()
	vi.stubGlobal('fetch', fetchMock)

	await expect(
		downloadFile('https://attacker.example/avatar.png', 3),
	).rejects.toThrow('not permitted')
	expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects redirects away from approved image hosts', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { Location: 'http://127.0.0.1/private' },
			}),
		),
	)

	await expect(
		downloadFile('https://avatars.githubusercontent.com/u/123', 3),
	).rejects.toThrow('not permitted')
})

test('rejects active content mislabeled as an image', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response('<script>alert(1)</script>', {
				status: 200,
				headers: { 'Content-Type': 'image/png' },
			}),
		),
	)

	await expect(
		downloadFile('https://cdn.myanimelist.net/images/avatar.png', 3),
	).rejects.toThrow('contents are not permitted')
})
