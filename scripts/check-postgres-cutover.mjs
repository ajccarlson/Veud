#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { sha256File } from './postgres-backup-receipt.mjs'
import { evaluatePostgresCutoverEvidence } from './postgres-cutover-utils.mjs'

const args = process.argv.slice(2)
const usage = `Usage: npm run db:cutover:postgres -- [evidence options]

Required:
  --policy PATH               Owner-approved cutover policy JSON
  --transfer-checkpoint PATH  Completed SQLite-to-PostgreSQL checkpoint
  --load-report PATH          Representative-scale load JSON report
  --backup PATH               Restore-verified PostgreSQL archive
  --canary-report PATH        Fresh application canary JSON report

Optional:
  --snapshot PATH             Snapshot named by the checkpoint
  --backup-receipt PATH       Receipt beside the archive by default
  --report PATH               Private gate report under test-results by default
  --help                      Show this help

This command is read-only. It verifies artifact hashes, target identity,
freshness, approved thresholds, restore counts, and canary health. It does not
perform a cutover or enable PostgreSQL writes.`

const valueFlags = new Set([
	'--policy',
	'--transfer-checkpoint',
	'--load-report',
	'--backup',
	'--backup-receipt',
	'--snapshot',
	'--canary-report',
	'--report',
])

function assertKnownArguments() {
	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		if (argument === '--help') continue
		if (valueFlags.has(argument)) {
			index++
			continue
		}
		throw new Error(`Unknown argument: ${argument}`)
	}
}

function valueFor(flag, required = false) {
	const index = args.indexOf(flag)
	const value = index < 0 ? undefined : args[index + 1]
	if (index >= 0 && (!value || value.startsWith('--'))) {
		throw new Error(`${flag} requires a value`)
	}
	if (required && !value) throw new Error(`${flag} is required`)
	return value
}

function existingPath(raw, label) {
	if (typeof raw !== 'string' || !raw.trim()) {
		throw new Error(`${label} path is required`)
	}
	const filename = path.resolve(raw)
	if (!fs.existsSync(filename))
		throw new Error(`${label} not found: ${filename}`)
	return filename
}

function readJson(filename, label) {
	try {
		return JSON.parse(fs.readFileSync(filename, 'utf8'))
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

async function measuredFile(filename) {
	return {
		name: path.basename(filename),
		bytes: fs.statSync(filename).size,
		sha256: await sha256File(filename),
	}
}

async function main() {
	assertKnownArguments()
	if (args.includes('--help')) {
		console.log(usage)
		return
	}
	const policyPath = existingPath(valueFor('--policy', true), 'Policy')
	const checkpointPath = existingPath(
		valueFor('--transfer-checkpoint', true),
		'Transfer checkpoint',
	)
	const loadReportPath = existingPath(
		valueFor('--load-report', true),
		'Load report',
	)
	const backupPath = existingPath(valueFor('--backup', true), 'Backup')
	const canaryReportPath = existingPath(
		valueFor('--canary-report', true),
		'Canary report',
	)
	const checkpoint = readJson(checkpointPath, 'Transfer checkpoint')
	const snapshotPath = existingPath(
		valueFor('--snapshot') ?? checkpoint.source,
		'Transfer snapshot',
	)
	const backupReceiptPath = existingPath(
		valueFor('--backup-receipt') ?? `${backupPath}.restore-verified.json`,
		'Backup receipt',
	)
	const reportPath = path.resolve(
		valueFor('--report') ??
			`test-results/postgres-cutover-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
	)

	const [
		actualSnapshot,
		actualBackup,
		policySha256,
		checkpointSha256,
		loadReportSha256,
		backupReceiptSha256,
		canaryReportSha256,
	] = await Promise.all([
		measuredFile(snapshotPath),
		measuredFile(backupPath),
		sha256File(policyPath),
		sha256File(checkpointPath),
		sha256File(loadReportPath),
		sha256File(backupReceiptPath),
		sha256File(canaryReportPath),
	])
	const result = evaluatePostgresCutoverEvidence({
		policy: readJson(policyPath, 'Policy'),
		checkpoint,
		loadReport: readJson(loadReportPath, 'Load report'),
		backupReceipt: readJson(backupReceiptPath, 'Backup receipt'),
		canaryReport: readJson(canaryReportPath, 'Canary report'),
		actualSnapshot,
		actualBackup,
		evidenceSha256: {
			policy: policySha256,
			checkpoint: checkpointSha256,
			loadReport: loadReportSha256,
			backupReceipt: backupReceiptSha256,
			canaryReport: canaryReportSha256,
		},
	})
	fs.mkdirSync(path.dirname(reportPath), { recursive: true })
	fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.chmodSync(reportPath, 0o600)
	console.log(`PostgreSQL cutover evidence passed for ${result.target}.`)
	console.log(`Approval: ${result.approval.approvedBy}`)
	console.log(`Gate report: ${reportPath}`)
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
