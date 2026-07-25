import { expect, test } from 'vitest'
import { resolveServerBinding } from '../../server/binding.ts'

test('production binds loopback and never selects another port', () => {
	expect(
		resolveServerBinding({ NODE_ENV: 'production', PORT: '4021' }),
	).toEqual({
		host: '127.0.0.1',
		port: 4021,
		allowPortFallback: false,
	})
})

test('an explicit production host is preserved', () => {
	expect(
		resolveServerBinding({
			NODE_ENV: 'production',
			PORT: '4021',
			HOST: '0.0.0.0',
		}).host,
	).toBe('0.0.0.0')
})

test('development may use a fallback port and rejects invalid ports', () => {
	expect(resolveServerBinding({ NODE_ENV: 'development' })).toMatchObject({
		host: undefined,
		port: 4021,
		allowPortFallback: true,
	})
	expect(() =>
		resolveServerBinding({ NODE_ENV: 'production', PORT: '70000' }),
	).toThrow(/PORT/)
})
