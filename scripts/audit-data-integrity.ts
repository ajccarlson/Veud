#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { auditDataIntegrity } from '#app/utils/data-integrity.server.ts'

const json = process.argv.includes('--json')
const failOnIssues = process.argv.includes('--fail-on-issues')
const knownArguments = new Set(['--json', '--fail-on-issues'])
for (const argument of process.argv.slice(2)) {
	if (!knownArguments.has(argument)) throw new Error(`Unknown argument: ${argument}`)
}

const prisma = new PrismaClient()
try {
	const report = await auditDataIntegrity(prisma)
	if (json) {
		console.log(JSON.stringify(report, null, 2))
	} else {
		console.log(
			[
				`Data integrity: ${report.healthy ? 'healthy' : 'errors found'}`,
				`Entries: ${report.summary.entries.toLocaleString()}`,
				`Tracking states: ${report.summary.trackingStates.toLocaleString()}`,
				`Personal scores: ${report.summary.entriesWithPositivePersonalScore.toLocaleString()} legacy / ${report.summary.entriesWithNormalizedScore.toLocaleString()} normalized`,
				`Provider scores: ${report.summary.entriesWithTmdbScore.toLocaleString()} TMDB / ${report.summary.entriesWithMalScore.toLocaleString()} MAL`,
				`Findings: ${report.errorCount.toLocaleString()} errors / ${report.warningCount.toLocaleString()} warnings`,
			].join('\n'),
		)
		for (const finding of report.findings) {
			console.log(
				`${finding.severity.toUpperCase()} ${finding.code}: ${finding.count}`,
			)
			for (const sample of finding.samples) {
				console.log(
					`  ${sample.title ?? sample.id} (${sample.id}): ${sample.detail}`,
				)
			}
		}
	}
	if (failOnIssues && !report.healthy) process.exitCode = 1
} finally {
	await prisma.$disconnect()
}
