import path from 'node:path'
import { fileURLToPath } from 'node:url'

function enabled(value: string | undefined) {
	return value === '1' || value === 'true'
}

export function assertSafeMockProductionRuntime(
	env: Record<string, string | undefined>,
	cwd = process.cwd(),
) {
	if (env.NODE_ENV !== 'production' || !enabled(env.MOCKS)) return
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
}
