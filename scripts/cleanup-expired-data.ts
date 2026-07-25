#!/usr/bin/env tsx
import 'dotenv/config'
import { prisma } from '#app/utils/db.server.ts'
import { cleanupExpiredData } from '#app/utils/retention.server.ts'

if (!process.argv.includes('--commit')) {
	throw new Error('Refusing to delete data without --commit.')
}

const result = await cleanupExpiredData(prisma)
console.log(
	JSON.stringify({
		event: 'retention.cleanup.completed',
		at: new Date().toISOString(),
		deleted: result,
	}),
)
await prisma.$disconnect()
