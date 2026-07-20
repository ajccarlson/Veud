import { describe, expect, test } from 'vitest'
import {
	destroyRedirectToHeader,
	getRedirectCookieHeader,
	getRedirectCookieValue,
} from './redirect-cookie.server.ts'
import { getTheme, setTheme } from './theme.server.ts'

describe('redirect cookies', () => {
	test('round trips an encoded redirect path', () => {
		const setCookie = getRedirectCookieHeader('/lists/example?tab=watching')

		expect(setCookie).toContain('redirectTo=')
		expect(setCookie).toContain('; Max-Age=600')

		const request = new Request('https://veud.test', {
			headers: { cookie: setCookie?.split(';')[0] ?? '' },
		})
		expect(getRedirectCookieValue(request)).toBe(
			'/lists/example?tab=watching',
		)
	})

	test('omits root redirects and expires stored redirects', () => {
		expect(getRedirectCookieHeader('/')).toBeNull()
		expect(getRedirectCookieHeader()).toBeNull()
		expect(destroyRedirectToHeader).toContain('redirectTo=')
		expect(destroyRedirectToHeader).toContain('; Max-Age=-1')
	})
})

describe('theme cookies', () => {
	test('reads supported themes and rejects unsupported values', () => {
		expect(getTheme(new Request('https://veud.test'))).toBe('light')
		expect(
			getTheme(
				new Request('https://veud.test', {
					headers: { cookie: 'en_theme=dark' },
				}),
			),
		).toBe('dark')
		expect(
			getTheme(
				new Request('https://veud.test', {
					headers: { cookie: 'en_theme=sepia' },
				}),
			),
		).toBeNull()
	})

	test('sets explicit themes and expires the cookie for system theme', () => {
		expect(setTheme('dark')).toContain('en_theme=dark')
		expect(setTheme('dark')).toContain('; Max-Age=31536000')
		expect(setTheme('dark')).toContain('; Path=/')
		expect(setTheme('system')).toContain('en_theme=')
		expect(setTheme('system')).toContain('; Max-Age=-1')
	})
})
