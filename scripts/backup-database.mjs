#!/usr/bin/env node
import 'dotenv/config'

if (process.env.NODE_ENV === 'development') {
	console.log('Skipping backup: NODE_ENV=development.')
} else if (/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL ?? '')) {
	await import('./backup-postgres.mjs')
} else {
	await import('./backup-db.mjs')
}

// better-sqlite3's asynchronous backup worker can retain an idle libuv handle
// after the completed module has closed the database. This command is a
// one-shot PM2 cron process, so exit explicitly after every awaited backup,
// restore verification, offsite copy, and log write has completed.
process.exit(0)
