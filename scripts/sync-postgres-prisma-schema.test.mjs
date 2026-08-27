import { expect, test } from 'vitest'
import { buildPostgresSchema } from './sync-postgres-prisma-schema.mjs'

const sqliteSchema = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Media {
  id          String @id
  title       String?
  description String?
}

model MediaTitle {
  id         String @id
  normalized String
}

model Person {
  id         String @id
  name       String
  normalized String
}
`

test('derives PostgreSQL provider and catalog indexes from the SQLite schema', () => {
	const result = buildPostgresSchema(sqliteSchema)

	expect(result).toContain('provider = "postgresql"')
	expect(result).not.toContain('provider = "sqlite"')
	expect(result).toContain('map: "Media_title_trgm_idx"')
	expect(result).toContain('map: "Media_description_trgm_idx"')
	expect(result).toContain('map: "MediaTitle_normalized_trgm_idx"')
	// People are searched by name the same way titles are, over a table that
	// grows faster than the catalog does.
	expect(result).toContain('map: "Person_normalized_trgm_idx"')
})

test('refuses to derive from a schema whose provider is not SQLite', () => {
	expect(() =>
		buildPostgresSchema(sqliteSchema.replace('"sqlite"', '"mysql"')),
	).toThrow('SQLite Prisma schema provider declaration was not found')
})

test('refuses to derive when a model it indexes has gone', () => {
	// Renaming or removing a model silently would drop its production search
	// index and leave a sequential scan behind, which nothing else would notice
	// until the table was large enough to hurt.
	expect(() =>
		buildPostgresSchema(
			sqliteSchema.replace('model Person {', 'model Human {'),
		),
	).toThrow('Missing Prisma model: Person')
})
