import closeWithGrace from 'close-with-grace'
import { setupServer } from 'msw/node'
import { handlers as openAiHandlers } from './openai.ts'
import { handlers as resendHandlers } from './resend.ts'

export const server = setupServer(...resendHandlers, ...openAiHandlers)

server.listen({
	onUnhandledRequest(request) {
		const url = new URL(request.url)
		const isSentry = url.hostname.endsWith('.sentry.io')
		const isLocal =
			url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]'
		if (isSentry || isLocal) return

		throw new Error(
			`Unhandled network request in tests: ${request.method} ${request.url}`,
		)
	},
})

if (process.env.NODE_ENV !== 'test') {
	console.info('🔶 Mock server installed')

	closeWithGrace(() => {
		server.close()
	})
}
