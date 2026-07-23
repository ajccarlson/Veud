import { expect, test, vi } from 'vitest'
import { loader } from './healthcheck.tsx'

test('healthcheck verifies the database without fetching a caller-controlled host', async () => {
	const fetchSpy = vi.spyOn(globalThis, 'fetch')
	const response = await loader()

	expect(response.status).toBe(200)
	expect(await response.text()).toBe('OK')
	expect(response.headers.get('cache-control')).toBe('no-store')
	expect(response.headers.get('x-veud-release')).toBeTruthy()
	expect(response.headers.get('x-veud-environment')).toBeTruthy()
	expect(fetchSpy).not.toHaveBeenCalled()
})
