import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	getPeopleSearchResults,
	getSearchSuggestions,
} from './search-suggestions.server.ts'
import { MIN_SUGGESTION_QUERY } from './search-suggestions.ts'

const DRAIN_MARKER = 'person-search-query-capture-drain'
let activeCapture: string[] | null = null
let drainResolve: (() => void) | null = null

prisma.$on('query', event => {
	if (event.query.includes(DRAIN_MARKER)) {
		drainResolve?.()
		return
	}
	activeCapture?.push(event.query)
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

async function capturedQueries(run: () => Promise<unknown>) {
	if (activeCapture) {
		throw new Error('Query captures may not overlap')
	}
	const seen: string[] = []
	activeCapture = seen
	try {
		await run()
		await drainQueryEvents()
		return seen
	} finally {
		activeCapture = null
	}
}

async function seedPerson(id: string, name: string, creditCount: number) {
	return prisma.person.create({
		data: { id, name, normalized: name.toLowerCase(), creditCount },
	})
}

test('live people suggestions rank on the stored count and never aggregate', async () => {
	// Person.creditCount exists so that search never aggregates MediaCredit
	// while someone types. Reverting to `orderBy: { credits: { _count } }` would
	// still return the right people, so nothing else notices. The PostgreSQL
	// scale gate captures this same application query before it
	// explains the plan. This focused test keeps the failure fast and local.
	await seedPerson('sugg-lead', 'Ana Lead', 40)
	await seedPerson('sugg-extra', 'Ana Extra', 1)

	const queries = await capturedQueries(() =>
		getSearchSuggestions({ q: 'ana', kind: 'all', limit: 8 }),
	)

	const personQueries = queries.filter(sql => sql.includes('Person'))
	expect(personQueries.length).toBeGreaterThan(0)
	for (const sql of personQueries) {
		expect(sql).not.toMatch(/\bGROUP BY\b/i)
		expect(sql).not.toMatch(/\bCOUNT\s*\(/i)
	}
	// One statement, not one per person.
	expect(personQueries).toHaveLength(1)
})

test('people search reads the count it orders by', async () => {
	await seedPerson('sugg-lead', 'Ana Lead', 40)
	await seedPerson('sugg-extra', 'Ana Extra', 1)

	const results = await getPeopleSearchResults('ana')

	expect(results.map(person => person.id)).toEqual(['sugg-lead', 'sugg-extra'])
	expect(results[0]?.creditCount).toBe(40)
})

test('a person with no remaining credits is not offered', async () => {
	await seedPerson('sugg-dead', 'Ana Dead', 0)
	expect(await getPeopleSearchResults('ana')).toEqual([])
})

test('live suggestions begin at an index-capable query length', () => {
	expect(MIN_SUGGESTION_QUERY).toBe(3)
})
