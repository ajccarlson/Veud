#!/usr/bin/env node
import 'dotenv/config'

try {
	if (process.env.NODE_ENV === 'development') {
		console.log('Skipping backup: NODE_ENV=development.')
	} else if (!process.env.DATABASE_URL?.trim()) {
		// Absence is the ambiguous case, not the value. Falling through to the
		// SQLite path here backs up a leftover file — or nothing at all — while
		// reporting success and leaving the real primary unprotected.
		throw new Error(
			'DATABASE_URL must be set so the backup can tell which database it is protecting',
		)
	} else if (/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL)) {
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
