#!/usr/bin/env node
import 'dotenv/config'

if (/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL ?? '')) {
	await import('./verify-postgres-backup.mjs')
} else {
	await import('./verify-backup.mjs')
}
