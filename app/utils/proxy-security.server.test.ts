import { expect, test } from 'vitest'
import {
	isLoopbackAddress,
	rateLimitClientKey,
} from './proxy-security.server.ts'

test('recognizes IPv4, mapped IPv4, and IPv6 loopback addresses', () => {
	expect(isLoopbackAddress('127.0.0.1')).toBe(true)
	expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
	expect(isLoopbackAddress('::1')).toBe(true)
	expect(isLoopbackAddress('192.168.1.10')).toBe(false)
})

test('trusts Cloudflare client IP only from the loopback tunnel', () => {
	expect(
		rateLimitClientKey({
			socketAddress: '127.0.0.1',
			cloudflareAddress: '203.0.113.20',
			requestAddress: '127.0.0.1',
		}),
	).toBe('203.0.113.20')
	expect(
		rateLimitClientKey({
			socketAddress: '192.168.1.10',
			cloudflareAddress: '203.0.113.20',
			requestAddress: '192.168.1.10',
		}),
	).toBe('192.168.1.10')
	expect(
		rateLimitClientKey({
			socketAddress: '127.0.0.1',
			cloudflareAddress: 'not-an-ip',
			requestAddress: '127.0.0.1',
		}),
	).toBe('127.0.0.1')
})
