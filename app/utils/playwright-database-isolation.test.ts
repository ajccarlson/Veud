import path from 'node:path'
import { expect, test } from 'vitest'
import { assertIsolatedDatabasePath } from '#tests/setup/playwright-database.ts'

test('rejects the development database as a Playwright target', () => {
	const developmentDatabase = path.join(process.cwd(), 'prisma/data.db')
	expect(() =>
		assertIsolatedDatabasePath(developmentDatabase, developmentDatabase),
	).toThrow('Playwright cannot use the development database')
})

test('rejects disposable databases outside the test database directory', () => {
	expect(() =>
		assertIsolatedDatabasePath(path.join(process.cwd(), 'playwright.db')),
	).toThrow('Playwright database must stay inside tests/prisma')
})

test('accepts an isolated database in the test database directory', () => {
	expect(() =>
		assertIsolatedDatabasePath(
			path.join(process.cwd(), 'tests/prisma/playwright.db'),
		),
	).not.toThrow()
})
