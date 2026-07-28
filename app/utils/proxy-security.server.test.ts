import { expect, test } from 'vitest'
import {
	anonymousRateLimitKey,
	isLoopbackAddress,
	isSameOriginMutation,
	normalizeClientAddress,
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

test('groups IPv6 identities by delegated /64 while preserving IPv4', () => {
	expect(normalizeClientAddress('203.0.113.20')).toBe('203.0.113.20')
	expect(normalizeClientAddress('::ffff:203.0.113.20')).toBe('203.0.113.20')
	expect(normalizeClientAddress('2001:db8:abcd:12::1')).toBe(
		'2001:0db8:abcd:0012::/64',
	)
	expect(normalizeClientAddress('2001:db8:abcd:12:ffff::99')).toBe(
		'2001:0db8:abcd:0012::/64',
	)
	expect(normalizeClientAddress('not-an-address')).toBe(null)
})

test('anonymous AI keys use only a trusted server-provided address', () => {
	const trustedIpv6 = rateLimitClientKey({
		socketAddress: '127.0.0.1',
		cloudflareAddress: '2001:db8:abcd:12::1',
		requestAddress: '127.0.0.1',
	})
	expect(trustedIpv6).toBe('2001:0db8:abcd:0012::/64')
	expect(anonymousRateLimitKey(trustedIpv6)).toBe(
		'anonymous:2001:0db8:abcd:0012::/64',
	)
	expect(anonymousRateLimitKey(undefined)).toBe('anonymous:shared')
})

test('requires same-origin evidence for anonymous browser mutations', () => {
	const endpoint = 'https://veud.example/resources/image-tip-of-tongue'
	expect(
		isSameOriginMutation(
			new Request(endpoint, {
				method: 'POST',
				headers: {
					origin: 'https://veud.example',
					'sec-fetch-site': 'same-origin',
				},
			}),
			{ requireEvidence: true },
		),
	).toBe(true)
	expect(
		isSameOriginMutation(
			new Request(endpoint, {
				method: 'POST',
				headers: { origin: 'https://attacker.example' },
			}),
			{ requireEvidence: true },
		),
	).toBe(false)
	expect(
		isSameOriginMutation(new Request(endpoint, { method: 'POST' }), {
			requireEvidence: true,
		}),
	).toBe(false)
})
