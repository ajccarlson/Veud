import { describe, expect, test } from 'vitest'
import { isInternalCommandAuthorized } from './internal-command.server.ts'

describe('internal command authorization', () => {
	test.each([undefined, '', '   ', 'REDACTED'])(
		'fails closed for an unusable configured token',
		token => {
			const request = new Request('https://veud.test/admin/cache/sqlite', {
				headers: { authorization: `Bearer ${String(token)}` },
			})
			expect(isInternalCommandAuthorized(request, token)).toBe(false)
		},
	)

	test('accepts only an exact bearer token', () => {
		const valid = new Request('https://veud.test/admin/cache/sqlite', {
			headers: { authorization: 'Bearer production-secret' },
		})
		const wrong = new Request('https://veud.test/admin/cache/sqlite', {
			headers: { authorization: 'Bearer production-secreu' },
		})

		expect(isInternalCommandAuthorized(valid, 'production-secret')).toBe(true)
		expect(isInternalCommandAuthorized(wrong, 'production-secret')).toBe(false)
	})
})
