import { parseCookie, stringifySetCookie } from 'cookie'

const key = 'redirectTo'
export const destroyRedirectToHeader = stringifySetCookie({
	name: key,
	value: '',
	maxAge: -1,
})

export function getRedirectCookieHeader(redirectTo?: string) {
	return redirectTo && redirectTo !== '/'
		? stringifySetCookie({ name: key, value: redirectTo, maxAge: 60 * 10 })
		: null
}

export function getRedirectCookieValue(request: Request) {
	const rawCookie = request.headers.get('cookie')
	const parsedCookies = rawCookie ? parseCookie(rawCookie) : {}
	const redirectTo = parsedCookies[key]
	return redirectTo || null
}
