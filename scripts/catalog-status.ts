#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { getCatalogOperationsSnapshot } from '#app/utils/catalog-operations.server.ts'

const usage = `Usage: npm run catalog:status -- [options]

Options:
  --json              Print the complete machine-readable snapshot
  --fail-on-degraded  Exit non-zero for warnings as well as critical health
  --help              Show this help

The command is read-only and uses DATABASE_URL. It exits non-zero for critical
catalog health by default.`

const args = process.argv.slice(2)
const knownArguments = new Set(['--json', '--fail-on-degraded', '--help'])

function printHuman(
	snapshot: Awaited<ReturnType<typeof getCatalogOperationsSnapshot>>,
) {
	console.log(
		`Catalog: ${snapshot.health.status} — ${snapshot.health.summary} (${snapshot.generatedAt.toISOString()})`,
	)
	for (const item of snapshot.coverage) {
		console.log(
			[
				`${item.provider}/${item.kind}`,
				`${item.hydrated.toLocaleString()}/${item.active.toLocaleString()} hydrated (${item.coveragePercent}%)`,
				`${item.queueDepth.toLocaleString()} eligible`,
				`${item.failedDeferred.toLocaleString()} deferred`,
				`${item.rateLimitEvents.toLocaleString()} 429s`,
			].join(' · '),
		)
	}
	for (const issue of snapshot.health.issues) {
		console.log(
			`${issue.severity === 'critical' ? 'CRITICAL' : 'WARNING'}: ${issue.title} — ${issue.detail}`,
		)
	}
}

async function main() {
	const unknown = args.filter(argument => !knownArguments.has(argument))
	if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`)
	if (args.includes('--help')) {
		console.log(usage)
		return
	}

	const prisma = new PrismaClient()
	try {
		const snapshot = await getCatalogOperationsSnapshot(prisma)
		if (args.includes('--json')) {
			console.log(JSON.stringify(snapshot, null, 2))
		} else {
			printHuman(snapshot)
		}
		if (
			snapshot.health.status === 'critical' ||
			(args.includes('--fail-on-degraded') &&
				snapshot.health.status === 'degraded')
		) {
			process.exitCode = 1
		}
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
