import * as Sentry from '@sentry/react-router'
import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'

/**
 * Where browser crashes are recorded.
 *
 * The browser posts here instead of carrying Sentry's SDK, and the report is
 * forwarded from the server, where a Sentry client is already configured. Every
 * error therefore ends up in one place regardless of which side it happened on.
 *
 * Unauthenticated on purpose: a crash on a signed-out page is exactly the kind
 * nobody would otherwise hear about. Nothing here trusts the payload — it is
 * bounded, shaped, and attributed as browser-reported so it can never be
 * mistaken for something the server observed itself.
 */
/** Comfortably above a real report, far below anything worth buffering. */
const MAX_REPORT_BYTES = 8 * 1024

const ClientErrorSchema = z.object({
	message: z.string().trim().min(1).max(500),
	stack: z.string().max(4_000).nullish(),
	// A path, never a full URL: no origin to spoof, no query string to leak.
	url: z
		.string()
		.max(500)
		.refine(value => value === '' || value.startsWith('/'), {
			message: 'url must be a path',
		})
		.optional(),
	release: z.string().max(100).nullish(),
})

export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== 'POST') {
		return json({ ok: false as const }, { status: 405 })
	}
	// Nothing upstream limits the body: the Express adapter hands the raw Node
	// stream through and no body-parser is installed, so `request.json()` would
	// buffer whatever is sent into the heap and only then let zod enforce the
	// field caps. On an unauthenticated endpoint that is a way to spend the
	// process's memory ceiling from outside.
	//
	// A real report is well under a kilobyte: 500 characters of message, 4,000
	// of stack, a path and a release.
	const declaredLength = Number(request.headers.get('content-length') ?? '')
	if (Number.isFinite(declaredLength) && declaredLength > MAX_REPORT_BYTES) {
		return json({ ok: false as const }, { status: 413 })
	}

	let payload: unknown
	try {
		const raw = await request.text()
		// Checked again after reading, because Content-Length is the sender's
		// claim and a chunked request carries none at all.
		if (raw.length > MAX_REPORT_BYTES) {
			return json({ ok: false as const }, { status: 413 })
		}
		payload = JSON.parse(raw)
	} catch {
		return json({ ok: false as const }, { status: 400 })
	}
	const parsed = ClientErrorSchema.safeParse(payload)
	if (!parsed.success) {
		return json({ ok: false as const }, { status: 400 })
	}

	const { message, stack, url, release } = parsed.data
	const error = new Error(message)
	// The browser's stack describes the browser's frames; keeping this one would
	// point every report at this file.
	error.stack = stack ?? undefined
	error.name = 'ClientError'

	Sentry.withScope(scope => {
		scope.setTag('source', 'browser')
		scope.setContext('browser report', {
			path: url ?? '',
			release: release ?? 'unknown',
		})
		Sentry.captureException(error)
	})
	console.error(
		`[client] ${message}${url ? ` (${url})` : ''}${release ? ` @${release}` : ''}`,
	)

	// Nothing to say back. A browser that just crashed has no use for a body.
	return new Response(null, { status: 204 })
}
