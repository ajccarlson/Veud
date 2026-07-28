import { expect, test } from 'vitest'
import { prismaSearchFilter } from './prisma-search.server.ts'

test('adds insensitive mode only for PostgreSQL datasources', () => {
	expect(
		prismaSearchFilter(
			'contains',
			'Mixed Case',
			'postgresql://veud:unused@localhost:5432/veud',
		),
	).toEqual({ contains: 'Mixed Case', mode: 'insensitive' })
	expect(
		prismaSearchFilter(
			'startsWith',
			'Mixed',
			'postgres://veud:unused@localhost:5432/veud',
		),
	).toEqual({ startsWith: 'Mixed', mode: 'insensitive' })
})

test('keeps SQLite and unknown datasource filters provider-portable', () => {
	expect(
		prismaSearchFilter('contains', 'Mixed Case', 'file:./tests/prisma/base.db'),
	).toEqual({ contains: 'Mixed Case' })
	expect(prismaSearchFilter('endsWith', 'Case', undefined)).toEqual({
		endsWith: 'Case',
	})
	expect(prismaSearchFilter('contains', 'Mixed Case', 'not a url')).toEqual({
		contains: 'Mixed Case',
	})
})
