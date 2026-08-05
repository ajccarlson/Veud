import { PassThrough } from 'stream'
import { createReadableStreamFromReadable } from '@react-router/node'
import {
	createSentryHandleError,
	wrapSentryHandleRequest,
} from '@sentry/react-router'
import { isbot } from 'isbot'
import { renderToPipeableStream } from 'react-dom/server'
import {
	ServerRouter,
	type HandleDocumentRequestFunction,
	type HandleErrorFunction,
} from 'react-router'
import { cspNonceContext } from './env.ts'
import { getEnv, init } from './utils/env.server.ts'
import { NonceProvider } from './utils/nonce-provider.ts'
import {
	createRequestId,
	recordOperationalError,
} from './utils/operations-observability.server.ts'
import { makeTimings } from './utils/timing.server.ts'

export {
	clientAddressContext,
	cspNonceContext,
	serverBuildContext,
} from './env.ts'

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
				<ServerRouter context={routerContext} nonce={nonce} url={request.url} />
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

const reportToSentry = createSentryHandleError({ logErrors: true })

/**
 * React Router calls this for every error thrown in a loader or an action.
 *
 * Those never reach the Express error middleware, which is the only thing that
 * recorded operational errors — so the operations dashboard's "recent server
 * errors" list was missing most application failures while looking complete.
 */
export const handleError: HandleErrorFunction = (error, args) => {
	// A client that navigated away aborts its own request. That is not a fault
	// of this server and must not be counted as one.
	if (!args.request.signal.aborted) {
		try {
			const url = new URL(args.request.url)
			recordOperationalError({
				requestId: createRequestId(),
				method: args.request.method,
				path: url.pathname,
				// React Router has already decided the response by this point; an
				// error reaching here produced a 500.
				status: 500,
				error,
			})
		} catch {
			// Recording an error must never become a second error.
		}
	}
	return reportToSentry(error, args)
}
