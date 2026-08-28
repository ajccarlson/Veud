import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { getPeopleSearchResults } from './search-suggestions.server.ts'
import { MIN_SUGGESTION_QUERY } from './search-suggestions.ts'

async function capturedQueries(run: () => Promise<unknown>) {
	const seen: string[] = []
	const record = (event: { query: string }) => {
		seen.push(event.query)
	}
	prisma.$on('query', record)
	try {
		await run()
	} finally {
		// Prisma has no $off; the listener is harmless once the array is read.
	}
	return seen
}

async function seedPerson(id: string, name: string, creditCount: number) {
	return prisma.person.create({
		data: { id, name, normalized: name.toLowerCase(), creditCount },
	})
}

test('people search ranks on the stored count and never aggregates', async () => {
	// Person.creditCount exists so that search never aggregates MediaCredit
	// while someone types. Reverting to `orderBy: { credits: { _count } }` would
	// still return the right people, so nothing else notices — and the
	// PostgreSQL scale gate would not either, because it measures its own
	// hand-written SQL rather than this query. Notice it here instead.
	await seedPerson('sugg-lead', 'Ana Lead', 40)
	await seedPerson('sugg-extra', 'Ana Extra', 1)

	const queries = await capturedQueries(() => getPeopleSearchResults('ana'))

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

test('the shortest accepted query is two characters', () => {
	// The PostgreSQL scale gate requires a trigram index in the plan, but a
	// pg_trgm index cannot serve a LIKE pattern with fewer than three
	// consecutive literal characters. Measured on 200,010 rows with the index
	// present and the match count held roughly equal, '%zqx%' took 0.046 ms on
	// a Bitmap Index Scan while '%zq%' took 46.18 ms on a sequential scan. At
	// this length the database must scan, so the gate measures that case rather
	// than only needles long enough to reach the index.
	expect(MIN_SUGGESTION_QUERY).toBe(2)
})
