import rateLimit from 'express-rate-limit'
import { expect, test } from 'vitest'
import { rateLimitClientKey } from '../app/utils/proxy-security.server.ts'

/**
 * The production limiter's options, built the same way `server/index.ts` builds
 * them. express-rate-limit validates its configuration when the first request
 * arrives, not when the middleware is constructed, so a misconfiguration after
 * a major upgrade surfaces as a runtime failure on a live request rather than
 * at boot — which is exactly the kind of thing a typecheck cannot see.
 */
function productionLimiter(limit: number) {
	return rateLimit({
		windowMs: 60 * 1000,
		limit,
		standardHeaders: true,
		legacyHeaders: false,
		keyGenerator: (req: any) =>
			rateLimitClientKey({
				socketAddress: req.socket?.remoteAddress,
				cloudflareAddress: req.get?.('cf-connecting-ip'),
				requestAddress: req.ip,
			}),
		// v8 reads the generator's source, sees `req.ip`, and warns that IPv6
		// clients might each get their own budget. This one already groups them by
		// /64, which the tests below prove, so the check is switched off knowingly.
		validate: { trustProxy: false, keyGeneratorIpFallback: false },
	})
}

function requestFrom(address: string) {
	const headers: Record<string, string> = {}
	return {
		ip: address,
		socket: { remoteAddress: address },
		get: (name: string) => headers[name.toLowerCase()],
		headers,
		method: 'GET',
		url: '/',
	}
}

function collectResponse() {
	const response: any = {
		statusCode: 200,
		headers: {} as Record<string, string>,
		setHeader(name: string, value: string) {
			response.headers[name] = value
		},
		getHeader: (name: string) => response.headers[name],
		removeHeader(name: string) {
			delete response.headers[name]
		},
		status(code: number) {
			response.statusCode = code
			return response
		},
		send() {
			return response
		},
		json() {
			return response
		},
		end() {
			return response
		},
		on() {
			return response
		},
		once() {
			return response
		},
		emit() {
			return false
		},
		writableEnded: false,
	}
	return response
}

async function drive(limiter: any, address: string, times: number) {
	const statuses: number[] = []
	for (let index = 0; index < times; index++) {
		const res = collectResponse()
		await new Promise<void>(resolve => {
			limiter(requestFrom(address), res, () => resolve())
			// A limited request never calls next(); the handler ends it instead.
			setTimeout(resolve, 0)
		})
		statuses.push(res.statusCode)
	}
	return statuses
}

test('the production limiter accepts its configuration and limits', async () => {
	const limiter = productionLimiter(3)
	const statuses = await drive(limiter, '203.0.113.5', 5)
	expect(statuses.slice(0, 3)).toEqual([200, 200, 200])
	expect(statuses.slice(3)).toEqual([429, 429])
})

test('one client running out of budget does not spend another one', async () => {
	const limiter = productionLimiter(2)
	await drive(limiter, '203.0.113.9', 3)
	const other = await drive(limiter, '198.51.100.4', 1)
	expect(other).toEqual([200])
})

test('IPv6 clients are grouped by their /64, not counted individually', async () => {
	// Two addresses in one /64 are one client; a rotating suffix must not mint
	// fresh budget. This is the property v8's own subnet validation checks for,
	// and the reason it is safe to switch that validation off here.
	const limiter = productionLimiter(2)
	await drive(limiter, '2001:db8:1:1::1', 2)
	const sameSubnet = await drive(limiter, '2001:db8:1:1::9999', 1)
	expect(sameSubnet).toEqual([429])

	const otherSubnet = await drive(limiter, '2001:db8:9:9::1', 1)
	expect(otherSubnet).toEqual([200])
})
