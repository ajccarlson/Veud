import { expect, test, vi } from 'vitest'
import { loader, withProbeTimeout } from './healthcheck.tsx'

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

test('a hung database fails the probe instead of hanging with it', async () => {
	// A hung database does not reject; it waits. Without a bound the probe waits
	// with it, and the checker sees a timeout it cannot attribute rather than a
	// failure it can.
	const never = new Promise<number>(() => {})
	await expect(
		withProbeTimeout(never, 10, ((handler: () => void) =>
			setTimeout(handler, 0)) as never),
	).rejects.toThrow('Database probe exceeded')
})

test('a probe that answers in time passes its value through', async () => {
	await expect(withProbeTimeout(Promise.resolve(7), 1_000)).resolves.toBe(7)
	await expect(
		withProbeTimeout(Promise.reject(new Error('down')), 1_000),
	).rejects.toThrow('down')
})
