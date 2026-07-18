import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

describe('auth session cookies', () => {
	test('production cookies are secure and can be read on the next request', async () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.resetModules()

		const { authSessionStorage } = await import('./session.server.ts')
		const session = await authSessionStorage.getSession()
		session.set('sessionId', 'session-value')

		const setCookie = await authSessionStorage.commitSession(session)

		expect(setCookie).toContain('; Path=/')
		expect(setCookie).toContain('; HttpOnly')
		expect(setCookie).toContain('; Secure')
		expect(setCookie).toContain('; SameSite=Lax')

		const cookieHeader = setCookie.slice(0, setCookie.indexOf(';'))
		vi.resetModules()
		const { authSessionStorage: nextRequestStorage } = await import(
			'./session.server.ts'
		)
		const restoredSession = await nextRequestStorage.getSession(cookieHeader)

		expect(restoredSession.get('sessionId')).toBe('session-value')
	})
})
