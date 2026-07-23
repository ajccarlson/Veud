#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { scanCatalogQuality } from '#app/utils/catalog-quality.server.ts'

const usage = `Usage: npm run catalog:quality-scan -- [options]

Options:
  --commit     Persist idempotent quality findings (default: dry-run)
  --limit N    Hydrated media to scan, 1-2000 (default: 500)
  --after ID   Resume after the last printed media cursor
  --help       Show this help

The scanner does not merge, delete, or rewrite catalog media. Commit mode only
upserts review findings; administrator decisions remain separate audit events.`

const args = process.argv.slice(2)

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) return undefined
	const value = args[index + 1]
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function assertKnownArguments() {
	const valueFlags = new Set(['--limit', '--after'])
	const booleanFlags = new Set(['--commit', '--help'])
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (booleanFlags.has(argument)) continue
		if (valueFlags.has(argument)) {
			index += 1
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function requestedLimit() {
	const raw = valueFor('--limit')
	if (raw === undefined) return 500
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < 1 || value > 2_000) {
		throw new Error('--limit must be an integer between 1 and 2000')
	}
	return value
}

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const commit = args.includes('--commit')
	const limit = requestedLimit()
	const afterMediaId = valueFor('--after')
	const prisma = new PrismaClient()
	try {
		const result = await scanCatalogQuality(prisma, {
			limit,
			commit,
			afterMediaId,
		})
		const byType = new Map<string, number>()
		for (const finding of result.findings) {
			byType.set(finding.issueType, (byType.get(finding.issueType) ?? 0) + 1)
		}
		const preview = result.findings.slice(0, 10)
		console.log(
			[
				`Mode: ${result.dryRun ? 'DRY-RUN' : 'COMMIT'}`,
				`Hydrated media scanned: ${result.scanned}`,
				`Media compared: ${result.compared}`,
				`Findings: ${result.findings.length}`,
				`Complete: ${result.complete ? 'yes' : 'no'}`,
				`Next cursor: ${result.nextCursor ?? 'none'}`,
				...([...byType.entries()].map(([type, count]) => `${type}: ${count}`) ??
					[]),
				...(preview.length
					? [
							'',
							`Candidate preview (${preview.length} of ${result.findings.length}):`,
							...preview.map(
								finding =>
									`- [${finding.issueType}] ${finding.summary} (${finding.primaryMediaId}${finding.secondaryMediaId ? `, ${finding.secondaryMediaId}` : ''})`,
							),
						]
					: []),
			].join('\n'),
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
