#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { type PrismaClient } from '@prisma/client'
import {
	assertSafeLoadDatabaseUrl,
	summarizeExplain,
} from './postgres-load-utils.mjs'

type AppPrisma = {
	$on(
		event: 'query',
		listener: (event: { query: string; params: string }) => void,
	): void
	$queryRawUnsafe: PrismaClient['$queryRawUnsafe']
	$disconnect: PrismaClient['$disconnect']
}
type GetSearchSuggestions = (input: {
	q: unknown
	kind?: unknown
	limit?: unknown
}) => Promise<Array<{ resultType: string }>>

const args = process.argv.slice(2)
const knownArguments = new Set([
	'--exact-query',
	'--broad-query',
	'--minimum-query',
	'--report',
])
const DRAIN_MARKER = 'person-search-measurement-drain'

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) throw new Error(`${flag} is required`)
	const value = args[index + 1]
	if (!value || value.startsWith('--'))
		throw new Error(`${flag} requires a value`)
	return value
}

function assertKnownArguments() {
	if (args.length !== knownArguments.size * 2) {
		throw new Error('Every person-search measurement argument is required once')
	}
	const seen = new Set<string>()
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index]
		const value = args[index + 1]
		if (!flag || !knownArguments.has(flag) || seen.has(flag)) {
			throw new Error(`Unknown or duplicate argument: ${flag ?? '(missing)'}`)
		}
		if (!value || value.startsWith('--'))
			throw new Error(`${flag} requires a value`)
		seen.add(flag)
	}
}

function writePrivateJson(filename: string, value: unknown) {
	fs.mkdirSync(path.dirname(filename), { recursive: true })
	const partial = `${filename}.partial`
	fs.writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.renameSync(partial, filename)
	fs.chmodSync(filename, 0o600)
}

type CapturedQuery = { query: string; params: string }

function queryValues(params: string) {
	const values: unknown = JSON.parse(params)
	if (
		!Array.isArray(values) ||
		values.some(
			value =>
				value !== null &&
				typeof value !== 'string' &&
				typeof value !== 'number' &&
				typeof value !== 'boolean',
		)
	) {
		throw new Error(
			'Captured person-search parameters must be scalar JSON values',
		)
	}
	return values
}

function createMeasurementRunner(
	prisma: AppPrisma,
	getSearchSuggestions: GetSearchSuggestions,
) {
	let activeCapture: CapturedQuery[] | null = null
	let drainResolve: (() => void) | null = null

	prisma.$on('query', event => {
		if (event.query.includes(DRAIN_MARKER)) {
			drainResolve?.()
			return
		}
		activeCapture?.push({ query: event.query, params: event.params })
	})

	async function drainQueryEvents() {
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error('Timed out draining Prisma query events')),
					10_000,
				)
				drainResolve = () => {
					clearTimeout(timer)
					resolve()
				}
				void prisma
					.$queryRawUnsafe(`SELECT 1 /* ${DRAIN_MARKER} */`)
					.catch(reject)
			})
		} finally {
			drainResolve = null
		}
	}

	return async function measure(name: string, query: string) {
		if (activeCapture) {
			throw new Error('Person-search measurements may not overlap')
		}
		const captured: CapturedQuery[] = []
		activeCapture = captured
		const started = performance.now()
		let suggestions
		try {
			suggestions = await getSearchSuggestions({
				q: query,
				kind: 'all',
				limit: 8,
			})
			await drainQueryEvents()
		} finally {
			activeCapture = null
		}
		const wallMs = Number((performance.now() - started).toFixed(3))
		const personQueries = captured.filter(event =>
			event.query.includes('"Person"'),
		)
		if (personQueries.length !== 1) {
			throw new Error(
				`${name} emitted ${personQueries.length} Person statements instead of exactly one`,
			)
		}
		const emitted = personQueries[0]!
		if (!/^\s*SELECT\b/i.test(emitted.query) || emitted.query.includes(';')) {
			throw new Error(`${name} emitted an unsafe or non-SELECT statement`)
		}
		if (/\bGROUP\s+BY\b|\bCOUNT\s*\(/i.test(emitted.query)) {
			throw new Error(
				`${name} aggregates credits instead of reading Person.creditCount`,
			)
		}
		const values = queryValues(emitted.params)
		const planRows = await prisma.$queryRawUnsafe(
			`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${emitted.query}`,
			...values,
		)
		return {
			name,
			wallMs,
			statementSha256: createHash('sha256').update(emitted.query).digest('hex'),
			parameterCount: values.length,
			applicationResultRows: suggestions.filter(
				suggestion => suggestion.resultType === 'person',
			).length,
			...summarizeExplain(planRows),
		}
	}
}

async function main() {
	assertKnownArguments()
	assertSafeLoadDatabaseUrl(process.env.DATABASE_URL)
	if (process.env.NODE_ENV !== 'test') {
		throw new Error('Person-search measurement must run in test mode')
	}
	const [{ prisma }, { getSearchSuggestions }] = await Promise.all([
		import('#app/utils/db.server.ts'),
		import('#app/utils/search-suggestions.server.ts'),
	])
	try {
		const measure = createMeasurementRunner(prisma, getSearchSuggestions)
		const reportPath = path.resolve(valueFor('--report'))
		const queries = []
		for (const [name, query] of [
			['person-name', valueFor('--exact-query')],
			['person-name-broad', valueFor('--broad-query')],
			['person-name-min-length', valueFor('--minimum-query')],
		] as const) {
			queries.push(await measure(name, query))
		}
		writePrivateJson(reportPath, { version: 1, queries })
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
