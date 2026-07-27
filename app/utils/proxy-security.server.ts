import net from 'node:net'

export function isLoopbackAddress(address: string | undefined) {
	if (!address) return false
	const normalized = address.toLowerCase().replace(/^::ffff:/, '')
	return (
		normalized === '::1' ||
		normalized === 'localhost' ||
		normalized.startsWith('127.')
	)
}

export function rateLimitClientKey({
	socketAddress,
	cloudflareAddress,
	requestAddress,
}: {
	socketAddress: string | undefined
	cloudflareAddress: string | undefined
	requestAddress: string | undefined
}) {
	const cloudflareIp = cloudflareAddress?.trim()
	if (
		isLoopbackAddress(socketAddress) &&
		cloudflareIp &&
		net.isIP(cloudflareIp)
	) {
		return cloudflareIp
	}
	return requestAddress || socketAddress || 'unknown'
}

// Route handlers only see request headers, so anonymous AI budgets key off the
// proxied client address and fall back to one shared bucket when none is sent.
export function anonymousRateLimitKey(headers: Headers) {
	const cloudflareIp = headers.get('cf-connecting-ip')?.trim()
	if (cloudflareIp && net.isIP(cloudflareIp)) return `anonymous:${cloudflareIp}`
	const forwardedIp = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
	if (forwardedIp && net.isIP(forwardedIp)) return `anonymous:${forwardedIp}`
	return 'anonymous:shared'
}
