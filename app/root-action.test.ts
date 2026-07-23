import { expect, test } from 'vitest'
import { action } from './root.tsx'

test('rejects malformed non-form root submissions as a client error', async () => {
	const result = await action({
		request: new Request('https://veud.test/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		}),
	} as any).catch(error => error)

	expect(result).toBeInstanceOf(Response)
	if (!(result instanceof Response)) throw new Error('Expected a response')
	expect(result.status).toBe(400)
})
