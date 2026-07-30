#!/usr/bin/env node

import { assertPristinePostgresDatabase } from './postgres-backup-operations.mjs'

if (process.argv.length !== 2) {
	console.error(
		'Usage: set DATABASE_URL, then run node scripts/assert-pristine-postgres.mjs',
	)
	process.exit(2)
}

try {
	await assertPristinePostgresDatabase({
		connectionUrl: process.env.DATABASE_URL,
	})
	console.log('PostgreSQL source satisfies pristine-empty-v1.')
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
}
