#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import { parse } from 'dotenv'
import {
	assertProductionDatabaseUrl,
	replaceEnvironmentValues,
} from '../../scripts/production-environment-utils.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const productionRoot =
	process.env.VEUD_PRODUCTION_ROOT || '/media/sde/veud-production'
const environmentPath = path.resolve(
	process.env.VEUD_ENV_FILE || path.join(repoRoot, '.env'),
)
const productionConfigPath = path.resolve(
	process.env.VEUD_PRODUCTION_CONFIG_FILE ||
		path.join(productionRoot, 'config/postgres.env'),
)
const rollbackEnvironmentPath = path.resolve(
	process.env.VEUD_CUTOVER_ENV_BACKUP ||
		path.join(productionRoot, 'config/sqlite-cutover.env'),
)

if (process.argv[2] !== 'SWITCH_VEUD_PRODUCTION') {
	throw new Error(
		'Type SWITCH_VEUD_PRODUCTION as the first argument to cross the write-cutover boundary',
	)
}

const currentText = fs.readFileSync(environmentPath, 'utf8')
const current = parse(currentText)
if (!current.DATABASE_URL?.startsWith('file:')) {
	throw new Error('The current application environment is not using SQLite')
}

const target = parse(fs.readFileSync(productionConfigPath, 'utf8'))
const targetIdentity = assertProductionDatabaseUrl(target.DATABASE_URL)
const allowedKeys = [
	'DATABASE_URL',
	'POSTGRES_BACKUP_VERIFY_URL',
	'BACKUP_DIR',
	'BACKUP_KEEP',
	'BACKUP_OFFSITE_DIR',
	'BACKUP_OFFSITE_KEEP',
	'BACKUP_OFFSITE_MOUNTPOINT',
	'BACKUP_OFFSITE_MIN_FREE_BYTES',
	'PG_DUMP_BIN',
	'PG_RESTORE_BIN',
	'PSQL_BIN',
]
const replacements = Object.fromEntries(
	allowedKeys.map(key => {
		if (!target[key]) {
			throw new Error(`Production configuration is missing ${key}`)
		}
		return [key, target[key]]
	}),
)

const sqlitePathValue = current.DATABASE_URL.slice('file:'.length)
const sqlitePath = path.resolve(repoRoot, sqlitePathValue)
const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true })
try {
	const identity = sqlite
		.prepare('SELECT username FROM User ORDER BY createdAt ASC LIMIT 1')
		.get()
	if (identity?.username)
		replacements.BACKUP_VERIFY_USERNAME = identity.username
} finally {
	sqlite.close()
}

fs.mkdirSync(path.dirname(rollbackEnvironmentPath), {
	recursive: true,
	mode: 0o700,
})
fs.copyFileSync(
	environmentPath,
	rollbackEnvironmentPath,
	fs.constants.COPYFILE_EXCL,
)
fs.chmodSync(rollbackEnvironmentPath, 0o600)

const nextText = replaceEnvironmentValues(currentText, replacements)
const partialPath = `${environmentPath}.partial-${process.pid}`
try {
	fs.writeFileSync(partialPath, nextText, { encoding: 'utf8', mode: 0o600 })
	fs.renameSync(partialPath, environmentPath)
	fs.chmodSync(environmentPath, 0o600)
} finally {
	fs.rmSync(partialPath, { force: true })
}

console.log(`Selected production database ${targetIdentity}.`)
console.log(
	`Preserved the pre-cutover environment at ${rollbackEnvironmentPath}.`,
)
console.log('No unrelated environment variables were changed.')
