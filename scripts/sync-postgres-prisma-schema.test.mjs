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
`

test('derives PostgreSQL provider and catalog indexes from the SQLite schema', () => {
	const result = buildPostgresSchema(sqliteSchema)

	expect(result).toContain('provider = "postgresql"')
	expect(result).not.toContain('provider = "sqlite"')
	expect(result).toContain('map: "Media_title_trgm_idx"')
	expect(result).toContain('map: "Media_description_trgm_idx"')
	expect(result).toContain('map: "MediaTitle_normalized_trgm_idx"')
})

test('refuses to derive from a schema whose provider is not SQLite', () => {
	expect(() =>
		buildPostgresSchema(sqliteSchema.replace('"sqlite"', '"mysql"')),
	).toThrow('SQLite Prisma schema provider declaration was not found')
})
