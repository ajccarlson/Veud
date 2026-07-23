import path from 'node:path'
import fsExtra from 'fs-extra'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { BASE_DATABASE_PATH } from './global-setup.ts'

// Vitest 4 does not guarantee that VITEST_POOL_ID is unique across every fork.
// A process id is unique for the lifetime of each fork and prevents one worker
// from replacing another worker's open SQLite file with a fresh template.
const databaseFile = `./tests/prisma/data.${process.pid}.db`
const databasePath = path.join(process.cwd(), databaseFile)
// connection_limit=1 forces a single SQLite connection (matching the app's own
// DATABASE_URL). Without it the test DB uses a multi-connection pool and a read can
// miss a write just committed on another pooled connection.
process.env.DATABASE_URL = `file:${databasePath}?connection_limit=1`

beforeAll(async () => {
	await fsExtra.copyFile(BASE_DATABASE_PATH, databasePath)
})

// we *must* use dynamic imports here so the process.env.DATABASE_URL is set
// before prisma is imported and initialized
afterEach(async () => {
	const { prisma } = await import('#app/utils/db.server.ts')
	const { cleanupDb } = await import('#tests/db-utils.ts')
	await cleanupDb(prisma)
})

afterAll(async () => {
	const { prisma } = await import('#app/utils/db.server.ts')
	await prisma.$disconnect()
	await fsExtra.remove(databasePath)
})
