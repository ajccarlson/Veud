import { execa } from 'execa'
import {
	PLAYWRIGHT_DATABASE_URL,
	preparePlaywrightDatabase,
	removePlaywrightDatabase,
} from './playwright-database.ts'

// Playwright starts the production server, so always build the current source.
// Without this, direct `playwright test` runs can silently exercise an old build.
await execa('npm', ['run', 'build'], {
	stdio: 'inherit',
	env: process.env,
})

await preparePlaywrightDatabase()

const server = execa('npm', ['run', 'start:mocks'], {
	stdio: 'inherit',
	env: { ...process.env, DATABASE_URL: PLAYWRIGHT_DATABASE_URL },
})

let stopping = false
async function stop(signal: NodeJS.Signals) {
	if (stopping) return
	stopping = true
	server.kill(signal)
	await server.catch(() => undefined)
	await removePlaywrightDatabase()
}

process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))

try {
	await server
} finally {
	await removePlaywrightDatabase()
}
