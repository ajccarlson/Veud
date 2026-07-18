import { describe, expect, test } from 'vitest'
import { headers as rootHeaders } from './root.tsx'
import { headers as connectionHeaders } from './routes/settings+/profile.connections.tsx'

const parentHeaders = new Headers()

describe('Single Fetch headers', () => {
	test('the root preserves loader and action cookies without overriding the stream content type', () => {
		const headers = new Headers(
			rootHeaders({
				actionHeaders: new Headers({
					'Content-Type': 'application/json',
					'Set-Cookie': 'theme=dark; Path=/',
				}),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Content-Type': 'application/json',
					'Server-Timing': 'root_loader;dur=1',
					'Set-Cookie': 'toast=; Path=/',
				}),
				parentHeaders,
			}),
		)

		expect(headers.get('Content-Type')).toBeNull()
		expect(headers.get('Server-Timing')).toBe('root_loader;dur=1')
		expect(headers.get('Set-Cookie')).toContain('toast=; Path=/')
		expect(headers.get('Set-Cookie')).toContain('theme=dark; Path=/')
	})

	test('the connections route preserves its action toast cookie', () => {
		const headers = new Headers(
			connectionHeaders({
				actionHeaders: new Headers({
					'Content-Type': 'application/json',
					'Set-Cookie': 'toast=deleted; Path=/',
				}),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Content-Type': 'application/json',
					'Server-Timing': 'connections;dur=1',
				}),
				parentHeaders,
			}),
		)

		expect(headers.get('Content-Type')).toBeNull()
		expect(headers.get('Server-Timing')).toBe('connections;dur=1')
		expect(headers.get('Set-Cookie')).toBe('toast=deleted; Path=/')
	})
})
