// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { prisma } from '#app/utils/db.server.ts'
import { releaseMetadata } from '#app/utils/operations-observability.server.ts'

/**
 * A hung database does not reject; it waits. Without a bound, the probe waits
 * with it and the checker sees a timeout it cannot attribute rather than a
 * failure it can.
 */
const DATABASE_PROBE_TIMEOUT_MS = 5_000

export function withProbeTimeout<Value>(
	probe: Promise<Value>,
	timeoutMs = DATABASE_PROBE_TIMEOUT_MS,
	schedule: typeof setTimeout = setTimeout,
) {
	return new Promise<Value>((resolve, reject) => {
		const timer = schedule(() => {
			reject(new Error(`Database probe exceeded ${timeoutMs}ms`))
		}, timeoutMs)
		probe.then(
			value => {
				clearTimeout(timer)
				resolve(value)
			},
			error => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

export async function loader() {
	try {
		// Serving this request already proves the HTTP process is responsive.
		// Avoid constructing a server-side request from untrusted Host headers.
		await withProbeTimeout(prisma.listType.count())
		const { release, environment } = releaseMetadata()
		return new Response('OK', {
			headers: {
				'Cache-Control': 'no-store',
				'X-Veud-Release': release,
				'X-Veud-Environment': environment,
			},
		})
	} catch (error: unknown) {
		console.error('healthcheck failed', error)
		return new Response('ERROR', {
			status: 500,
			headers: { 'Cache-Control': 'no-store' },
		})
	}
}
