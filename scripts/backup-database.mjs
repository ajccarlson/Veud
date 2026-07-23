#!/usr/bin/env node
import 'dotenv/config'

try {
	if (process.env.NODE_ENV === 'development') {
		console.log('Skipping backup: NODE_ENV=development.')
	} else if (/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL ?? '')) {
		await import('./backup-postgres.mjs')
	} else {
		await import('./backup-db.mjs')
	}
} catch (error) {
	const message =
		error instanceof Error ? (error.stack ?? error.message) : String(error)
	await new Promise((resolve, reject) => {
		process.stderr.write(`${message}\n`, writeError => {
			if (writeError) reject(writeError)
			else resolve()
		})
	})
	process.exit(1)
}

// better-sqlite3's asynchronous backup worker can retain an idle libuv handle
// after the completed module has closed the database. Failed PostgreSQL child
// operations can retain handles as well. This is a one-shot PM2 cron process,
// so exit explicitly after every completed or failed attempt.
process.exit(0)
