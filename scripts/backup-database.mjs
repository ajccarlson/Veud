#!/usr/bin/env node
import 'dotenv/config'

if (process.env.NODE_ENV === 'development') {
	console.log('Skipping backup: NODE_ENV=development.')
} else if (/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL ?? '')) {
	await import('./backup-postgres.mjs')
} else {
	await import('./backup-db.mjs')
}
