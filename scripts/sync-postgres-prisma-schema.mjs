#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const sqliteSchemaPath = path.resolve('prisma/schema.prisma')
export const postgresSchemaPath = path.resolve(
	'prisma/postgresql/schema.prisma',
)

function addModelIndexes(schema, modelName, indexes) {
	const modelStart = schema.indexOf(`model ${modelName} {`)
	if (modelStart < 0) throw new Error(`Missing Prisma model: ${modelName}`)
	const modelEnd = schema.indexOf('\n}', modelStart)
	if (modelEnd < 0) throw new Error(`Unterminated Prisma model: ${modelName}`)
	return `${schema.slice(0, modelEnd)}\n${indexes.join('\n')}${schema.slice(modelEnd)}`
}

export function buildPostgresSchema(sqliteSchema) {
	const provider = '  provider = "sqlite"'
	if (!sqliteSchema.includes(provider)) {
		throw new Error('SQLite Prisma schema provider declaration was not found')
	}

	let schema = sqliteSchema.replace(provider, '  provider = "postgresql"')
	schema = addModelIndexes(schema, 'Media', [
		'  // PostgreSQL provider-scale substring search indexes.',
		'  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "Media_title_trgm_idx")',
		'  @@index([description(ops: raw("gin_trgm_ops"))], type: Gin, map: "Media_description_trgm_idx")',
	])
	schema = addModelIndexes(schema, 'MediaTitle', [
		'  // Powers normalized canonical and alternate-title substring matching.',
		'  @@index([normalized(ops: raw("gin_trgm_ops"))], type: Gin, map: "MediaTitle_normalized_trgm_idx")',
	])
	return schema
}

export function syncPostgresSchema({ check = false } = {}) {
	const sqliteSchema = fs.readFileSync(sqliteSchemaPath, 'utf8')
	const expected = buildPostgresSchema(sqliteSchema)
	const actual = fs.existsSync(postgresSchemaPath)
		? fs.readFileSync(postgresSchemaPath, 'utf8')
		: null

	if (check) {
		if (actual !== expected) {
			throw new Error(
				'prisma/postgresql/schema.prisma is stale; run npm run prisma:postgres:sync-schema',
			)
		}
		return false
	}

	if (actual === expected) return false
	fs.mkdirSync(path.dirname(postgresSchemaPath), { recursive: true })
	fs.writeFileSync(postgresSchemaPath, expected)
	return true
}

const isMain =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
	try {
		const check = process.argv.includes('--check')
		const changed = syncPostgresSchema({ check })
		console.log(
			check
				? 'PostgreSQL Prisma schema matches the SQLite source schema.'
				: changed
					? 'Updated prisma/postgresql/schema.prisma.'
					: 'PostgreSQL Prisma schema is already current.',
		)
	} catch (error) {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	}
}
