import { PassThrough } from 'stream'
import { createReadableStreamFromReadable } from '@react-router/node'
import {
	createSentryHandleError,
	wrapSentryHandleRequest,
} from '@sentry/react-router'
import { isbot } from 'isbot'
import { renderToPipeableStream } from 'react-dom/server'
import { ServerRouter, type HandleDocumentRequestFunction } from 'react-router'
import { cspNonceContext } from './env.ts'
import { getEnv, init } from './utils/env.server.ts'
import { NonceProvider } from './utils/nonce-provider.ts'
import { makeTimings } from './utils/timing.server.ts'

export { cspNonceContext, serverBuildContext } from './env.ts'

export const streamTimeout = 5000

init()
global.ENV = getEnv()

type DocRequestArgs = Parameters<HandleDocumentRequestFunction>

async function handleRequest(...args: DocRequestArgs) {
	const [
		request,
		responseStatusCode,
		responseHeaders,
		routerContext,
		loadContext,
	] = args

	const callbackName = isbot(request.headers.get('user-agent'))
		? 'onAllReady'
		: 'onShellReady'

	const nonce = loadContext.get(cspNonceContext)
	return new Promise(async (resolve, reject) => {
		let didError = false
		// NOTE: this timing will only include things that are rendered in the shell
		// and will not include suspended components and deferred loaders
		const timings = makeTimings('render', 'renderToPipeableStream')

		const { pipe, abort } = renderToPipeableStream(
			<NonceProvider value={nonce}>
				<ServerRouter
					context={routerContext}
					nonce={nonce}
					url={request.url}
				/>
			</NonceProvider>,
			{
				[callbackName]: () => {
					const body = new PassThrough()
					responseHeaders.set('Content-Type', 'text/html')
					responseHeaders.append('Server-Timing', timings.toString())
					resolve(
						new Response(createReadableStreamFromReadable(body), {
							headers: responseHeaders,
							status: didError ? 500 : responseStatusCode,
						}),
					)
					pipe(body)
				},
				onShellError: (err: unknown) => {
					reject(err)
				},
				onError: (error: unknown) => {
					didError = true

					console.error(error)
				},
				nonce,
			},
		)

		setTimeout(abort, streamTimeout + 1000)
	})
}

export default wrapSentryHandleRequest(handleRequest)

export async function handleDataRequest(response: Response) {
	return response
}

export const handleError = createSentryHandleError({ logErrors: true })
