#!/usr/bin/env -S npx tsx
import fs from 'node:fs'
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
	getReleaseDataIntegritySnapshot,
	removeConfirmedTestMediaFixtures,
} from '#app/utils/release-data-integrity.server.ts'

const usage = `Usage:
  npm run data:release-audit -- [--json]
  npm run data:release-audit -- --commit-fixture-removal \\
    --expected-database <database> \\
    --backup-receipt <restore-verified.json> \\
    --confirm REMOVE_CONFIRMED_VEUD_TEST_FIXTURES

The audit is read-only by default. Committed cleanup removes only the five exact
browser-fixture media records and the exact isolated fixture account confirmed
in DATA-002. It refuses any unexpected member-owned data and requires a fresh
restore-verified PostgreSQL backup receipt.`

function valueAfter(name: string) {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

function databaseIdentity() {
	const raw = process.env.DATABASE_URL
	if (!raw) throw new Error('DATABASE_URL is required.')
	const url = new URL(raw)
	if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
		throw new Error('Committed release cleanup requires PostgreSQL.')
	}
	return {
		name: decodeURIComponent(url.pathname.replace(/^\//, '')),
		target: `${url.hostname.toLowerCase()}:${url.port || '5432'}/${decodeURIComponent(url.pathname.replace(/^\//, ''))}`,
	}
}

function assertFreshBackupReceipt(filename: string, sourceTarget: string) {
	const parsed = JSON.parse(fs.readFileSync(filename, 'utf8')) as {
		version?: number
		verifiedAt?: string
		sourceTarget?: string
		checks?: { expectedIdentity?: boolean }
	}
	const verifiedAt = new Date(parsed.verifiedAt ?? '')
	if (
		parsed.version !== 1 ||
		parsed.sourceTarget !== sourceTarget ||
		parsed.checks?.expectedIdentity !== true ||
		!Number.isFinite(verifiedAt.getTime()) ||
		Date.now() - verifiedAt.getTime() > 24 * 60 * 60 * 1_000
	) {
		throw new Error(
			'Backup receipt must be restore-verified for this database within the last 24 hours.',
		)
	}
}

async function main() {
	if (process.argv.includes('--help')) {
		console.log(usage)
		return
	}
	const known = new Set([
		'--help',
		'--json',
		'--commit-fixture-removal',
		'--expected-database',
		'--backup-receipt',
		'--confirm',
	])
	for (let index = 2; index < process.argv.length; index += 1) {
		const argument = process.argv[index]
		if (!known.has(argument)) throw new Error(`Unknown argument: ${argument}`)
		if (
			['--expected-database', '--backup-receipt', '--confirm'].includes(
				argument,
			)
		) {
			index += 1
		}
	}

	const prisma = new PrismaClient()
	try {
		const snapshot = await getReleaseDataIntegritySnapshot(prisma)
		if (process.argv.includes('--json')) {
			console.log(JSON.stringify(snapshot, null, 2))
		} else {
			console.log(
				`Release-data audit at ${snapshot.generatedAt.toISOString()}: ${snapshot.fixtureFamily.length} fixture-family record(s), ${snapshot.providerless.count.toLocaleString()} provider-less media record(s).`,
			)
			for (const item of snapshot.fixtureFamily) {
				console.log(
					`- ${item.id} · ${item.title ?? 'Untitled'} · ${item.memberAttachmentTotal} member attachment(s)`,
				)
			}
			for (const item of snapshot.testEmailDomains) {
				if (!item.count) continue
				console.log(
					`- test email domain ${item.domain}: ${item.count.toLocaleString()} account(s); review required (no automatic deletion)`,
				)
			}
		}
		if (!process.argv.includes('--commit-fixture-removal')) return

		const expectedDatabase = valueAfter('--expected-database')
		const receipt = valueAfter('--backup-receipt')
		const confirmation = valueAfter('--confirm')
		if (
			!expectedDatabase ||
			!receipt ||
			confirmation !== 'REMOVE_CONFIRMED_VEUD_TEST_FIXTURES'
		) {
			throw new Error(usage)
		}
		const identity = databaseIdentity()
		if (identity.name !== expectedDatabase) {
			throw new Error(
				`Database safety check failed: expected “${expectedDatabase}”, received “${identity.name}”.`,
			)
		}
		assertFreshBackupReceipt(receipt, identity.target)
		const result = await removeConfirmedTestMediaFixtures(prisma)
		console.log(
			result.removed.length
				? `Removed confirmed fixtures: ${result.removed.join(', ')}${result.removedFixtureAccount ? '; removed the exact isolated fixture account' : ''}`
				: result.removedFixtureAccount
					? 'The fixture media were already absent; removed the exact isolated fixture account.'
					: 'The confirmed fixture family and account are already absent.',
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
