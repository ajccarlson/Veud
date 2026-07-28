import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function enabled(value: string | undefined) {
	return value === '1' || value === 'true'
}

function loopbackHttpUrl(value: string) {
	try {
		const url = new URL(value)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
		const hostname = url.hostname
			.toLowerCase()
			.replace(/^\[/, '')
			.replace(/\]$/, '')
			.replace(/^::ffff:/, '')
		if (hostname === 'localhost' || hostname === '::1') return true
		return net.isIP(hostname) === 4 && hostname.split('.')[0] === '127'
	} catch {
		return false
	}
}

export function assertSafeMockProductionRuntime(
	env: Record<string, string | undefined>,
	cwd = process.cwd(),
) {
	if (env.NODE_ENV !== 'production') return false

	const mocksEnabled = enabled(env.MOCKS)
	const playwrightBaseUrl = env.PLAYWRIGHT_TEST_BASE_URL?.trim()
	if (playwrightBaseUrl && !mocksEnabled) {
		throw new Error(
			'Production-mode Playwright server requires the explicit MOCKS=true marker.',
		)
	}
	if (!mocksEnabled) return false

	if (!enabled(env.VEUD_E2E)) {
		throw new Error(
			'Production-mode mock server requires the explicit VEUD_E2E=1 marker.',
		)
	}
	const databaseUrl = env.DATABASE_URL
	if (!databaseUrl?.startsWith('file:')) {
		throw new Error(
			'Production-mode mock server requires a disposable SQLite database.',
		)
	}
	const databasePath = fileURLToPath(
		databaseUrl.slice(
			0,
			databaseUrl.indexOf('?') === -1 ? undefined : databaseUrl.indexOf('?'),
		),
	)
	const resolved = path.resolve(databasePath)
	const testDirectory = `${path.resolve(cwd, 'tests/prisma')}${path.sep}`
	if (!resolved.startsWith(testDirectory)) {
		throw new Error(
			'Production-mode mock server database must stay inside tests/prisma.',
		)
	}

	if (playwrightBaseUrl && !loopbackHttpUrl(playwrightBaseUrl)) {
		throw new Error(
			'Production-mode Playwright server base URL must use loopback HTTP(S).',
		)
	}

	return true
}
