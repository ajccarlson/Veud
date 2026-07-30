#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
	CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
	repairMediaCatalogProvenance,
} from '#app/utils/media-provenance-repair.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

const args = process.argv.slice(2)
const known = new Set([
	'--batch-size',
	'--commit',
	'--confirm',
	'--require-clean',
	'--help',
])
for (let index = 0; index < args.length; index++) {
	const argument = args[index]
	if (!known.has(argument)) throw new Error(`Unknown argument: ${argument}`)
	if (argument === '--batch-size' || argument === '--confirm') index += 1
}

if (args.includes('--help')) {
	console.log(`Usage: npm run catalog:repair-provenance -- [options]

Options:
  --batch-size N    Rows repaired per transaction (default: 100)
  --commit          Persist the repair (default: dry-run)
  --confirm PHRASE  Required with --commit:
                    ${CATALOG_PROVENANCE_REPAIR_CONFIRMATION}
  --require-clean   Fail unless the durable repair boundary is complete
  --help            Show this help`)
	process.exit(0)
}

function valueAfter(flag: string) {
	const index = args.indexOf(flag)
	return index < 0 ? undefined : args[index + 1]
}

const batchSizeValue = valueAfter('--batch-size')
const batchSize =
	batchSizeValue === undefined ? undefined : Number(batchSizeValue)
const prisma = new PrismaClient()

try {
	const result = await repairMediaCatalogProvenance(prisma, {
		batchSize,
		commit: args.includes('--commit'),
		confirmation: valueAfter('--confirm'),
	})
	if (args.includes('--require-clean') && !result.completed) {
		throw new Error('Catalog provenance repair is not complete')
	}
	console.log(
		JSON.stringify(
			{
				mode: result.dryRun ? 'dry-run' : 'commit',
				blocked: result.blocked,
				completed: result.completed,
				alreadyCompleted: result.alreadyCompleted,
				processedMedia: result.processedMedia,
				before: result.before,
				after: result.after,
			},
			null,
			2,
		),
	)
} finally {
	await prisma.$disconnect()
}
