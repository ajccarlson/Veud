import { describe, expect, test } from 'vitest'
import { headers as rootHeaders, loader as rootLoader } from './root.tsx'
import { headers as connectionHeaders } from './routes/settings+/profile.connections.tsx'
import { profileHeaders } from './utils/profile-headers.ts'

const parentHeaders = new Headers()

describe('Single Fetch headers', () => {
	test('the root loader marks its account-aware data private and non-cacheable', async () => {
		const url = new URL('https://veud.example/')
		const response = await rootLoader({
			request: new Request(url),
			url,
			params: {},
		} as unknown as Parameters<typeof rootLoader>[0])

		expect(new Headers(response.init?.headers).get('Cache-Control')).toBe(
			'private, no-store',
		)
	})

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
		expect(headers.get('Cache-Control')).toBe('private, no-store')
		expect(headers.get('Server-Timing')).toBe('root_loader;dur=1')
		expect(headers.get('Set-Cookie')).toContain('toast=; Path=/')
		expect(headers.get('Set-Cookie')).toContain('theme=dark; Path=/')
	})

	test('the root overrides cacheable child metadata at the document boundary', () => {
		const headers = new Headers(
			rootHeaders({
				actionHeaders: new Headers({
					'Cache-Control': 'public, max-age=3600',
				}),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Cache-Control': 'public, s-maxage=3600',
				}),
				parentHeaders,
			}),
		)

		expect(headers.get('Cache-Control')).toBe('private, no-store')
	})

	test('the connections route preserves its action toast cookie', () => {
		const rootDocumentHeaders = new Headers(
			rootHeaders({
				actionHeaders: new Headers(),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Server-Timing': 'root_loader;dur=1',
				}),
				parentHeaders,
			}),
		)
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
				parentHeaders: rootDocumentHeaders,
			}),
		)

		expect(headers.get('Content-Type')).toBeNull()
		expect(headers.get('Cache-Control')).toBe('private, no-store')
		expect(headers.get('Server-Timing')).toBe(
			'root_loader;dur=1,connections;dur=1',
		)
		expect(headers.get('Set-Cookie')).toBe('toast=deleted; Path=/')
	})

	test('nested profile header composition preserves the root no-store policy', () => {
		const rootDocumentHeaders = new Headers(
			rootHeaders({
				actionHeaders: new Headers(),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Server-Timing': 'root_loader;dur=1',
				}),
				parentHeaders,
			}),
		)
		const profileShellHeaders = new Headers(
			profileHeaders({
				actionHeaders: new Headers(),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Server-Timing': 'profile_shell;dur=2',
				}),
				parentHeaders: rootDocumentHeaders,
			}),
		)
		const profileTabHeaders = new Headers(
			profileHeaders({
				actionHeaders: new Headers(),
				errorHeaders: undefined,
				loaderHeaders: new Headers({
					'Server-Timing': 'profile_tab;dur=3',
				}),
				parentHeaders: profileShellHeaders,
			}),
		)

		expect(profileTabHeaders.get('Cache-Control')).toBe('private, no-store')
		expect(profileTabHeaders.get('Server-Timing')).toBe(
			'root_loader;dur=1,profile_shell;dur=2,profile_tab;dur=3',
		)
	})
})
