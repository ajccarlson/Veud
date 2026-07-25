#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { synchronizeWatchlistMetadata } from '#app/utils/watchlist-metadata-sync.server.ts'

const args = process.argv.slice(2)
const allowed = new Set(['--commit', '--batch-size', '--help'])
for (let index = 0; index < args.length; index++) {
	const argument = args[index]
	if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`)
	if (argument === '--batch-size') index += 1
}

if (args.includes('--help')) {
	console.log(`Usage: npm run catalog:sync-watchlist-metadata -- [options]

Options:
  --commit          Persist catalog-owned metadata changes (default: dry-run)
  --batch-size N    Entries scanned per batch (default: 500)
  --help            Show this help`)
	process.exit(0)
}

const batchIndex = args.indexOf('--batch-size')
const batchSize =
	batchIndex < 0 ? 500 : Number(args[batchIndex + 1] ?? Number.NaN)
const prisma = new PrismaClient()

try {
	const result = await synchronizeWatchlistMetadata(prisma, {
		batchSize,
		commit: args.includes('--commit'),
	})
	console.log(
		[
			result.dryRun ? 'Watchlist metadata dry run' : 'Watchlist metadata sync',
			`scanned=${result.scanned}`,
			`matched=${result.matched}`,
			`updated=${result.updated}`,
		].join(' · '),
	)
} finally {
	await prisma.$disconnect()
}
