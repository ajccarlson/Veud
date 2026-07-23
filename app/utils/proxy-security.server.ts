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
