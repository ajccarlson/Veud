import net from 'node:net'

function ipv4TailToHextets(value: string) {
	const octets = value.split('.').map(part => Number.parseInt(part, 10))
	if (
		octets.length !== 4 ||
		octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
	) {
		return null
	}
	return [(octets[0]! << 8) + octets[1]!, (octets[2]! << 8) + octets[3]!]
}

function ipv6Hextets(address: string) {
	const halves = address.toLowerCase().split('::')
	if (halves.length > 2) return null
	const parseHalf = (half: string) => {
		if (!half) return [] as number[]
		const parts = half.split(':')
		const hextets: number[] = []
		for (const part of parts) {
			if (part.includes('.')) {
				const tail = ipv4TailToHextets(part)
				if (!tail) return null
				hextets.push(...tail)
				continue
			}
			const value = Number.parseInt(part, 16)
			if (!part || !/^[0-9a-f]{1,4}$/.test(part) || !Number.isInteger(value)) {
				return null
			}
			hextets.push(value)
		}
		return hextets
	}
	const left = parseHalf(halves[0] ?? '')
	const right = parseHalf(halves[1] ?? '')
	if (!left || !right) return null
	const omitted = 8 - left.length - right.length
	if (
		(halves.length === 1 && omitted !== 0) ||
		(halves.length === 2 && omitted < 1)
	) {
		return null
	}
	return [...left, ...Array.from({ length: omitted }, () => 0), ...right]
}

/**
 * Returns a stable rate-limit identity. IPv6 clients are grouped by /64 so a
 * single delegated residential network cannot mint a new budget per address.
 */
export function normalizeClientAddress(address: string | undefined) {
	if (!address) return null
	const trimmed = address.trim().toLowerCase()
	const mappedIpv4 = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
	if (mappedIpv4 && net.isIP(mappedIpv4) === 4) return mappedIpv4
	const version = net.isIP(trimmed)
	if (version === 4) return trimmed
	if (version !== 6) return null
	const hextets = ipv6Hextets(trimmed)
	if (!hextets || hextets.length !== 8) return null
	return `${hextets
		.slice(0, 4)
		.map(value => value.toString(16).padStart(4, '0'))
		.join(':')}::/64`
}

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
		return normalizeClientAddress(cloudflareIp) ?? 'unknown'
	}
	return (
		normalizeClientAddress(requestAddress) ??
		normalizeClientAddress(socketAddress) ??
		'unknown'
	)
}

// Route handlers receive this value from the trusted Express request context;
// they never reconstruct client identity from caller-controlled headers.
export function anonymousRateLimitKey(clientAddress: string | undefined) {
	const normalizedPrefix = clientAddress?.endsWith('/64')
		? normalizeClientAddress(clientAddress.slice(0, -3))
		: null
	const normalized =
		normalizedPrefix === clientAddress
			? normalizedPrefix
			: normalizeClientAddress(clientAddress)
	return normalized ? `anonymous:${normalized}` : 'anonymous:shared'
}

export function isSameOriginMutation(
	request: Request,
	{ requireEvidence = process.env.NODE_ENV === 'production' } = {},
) {
	const expectedOrigin = new URL(request.url).origin
	const suppliedOrigin = request.headers.get('origin')
	const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
	if (suppliedOrigin) {
		try {
			if (new URL(suppliedOrigin).origin !== expectedOrigin) return false
		} catch {
			return false
		}
	}
	if (fetchSite && fetchSite !== 'same-origin') return false
	if (suppliedOrigin || fetchSite === 'same-origin') return true
	return !requireEvidence
}
