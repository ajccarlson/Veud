// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { prisma } from '#app/utils/db.server.ts'

export async function loader() {
	try {
		// Serving this request already proves the HTTP process is responsive.
		// Avoid constructing a server-side request from untrusted Host headers.
		await prisma.listType.count()
		return new Response('OK', {
			headers: { 'Cache-Control': 'no-store' },
		})
	} catch (error: unknown) {
		console.error('healthcheck failed', error)
		return new Response('ERROR', {
			status: 500,
			headers: { 'Cache-Control': 'no-store' },
		})
	}
}
