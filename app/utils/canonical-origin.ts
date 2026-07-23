const DEFAULT_PRODUCTION_ORIGIN = 'https://veud.net'

function httpOrigin(value: string | undefined) {
	if (!value?.trim()) return null
	try {
		const url = new URL(value)
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.origin
			: null
	} catch {
		return null
	}
}

export function canonicalOriginFromEnvironment(
	env: Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'VEUD_ORIGIN'> = process.env,
) {
	return (
		httpOrigin(env.VEUD_ORIGIN) ??
		(env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_ORIGIN : null)
	)
}

export function getCanonicalOrigin(request: Request) {
	const configured = canonicalOriginFromEnvironment()
	if (configured) return configured

	const requestUrl = new URL(request.url)
	const forwardedHost = request.headers.get('X-Forwarded-Host')?.split(',')[0]
	const host = forwardedHost?.trim() || request.headers.get('host')
	if (!host) return requestUrl.origin

	return httpOrigin(`${requestUrl.protocol}//${host}`) ?? requestUrl.origin
}
