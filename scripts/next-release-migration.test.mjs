import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import { afterEach, expect, test } from 'vitest'
import { deriveNextReleaseAt } from '#app/utils/release-occurrences.server.ts'

let database
let prisma
let temporaryDirectory

afterEach(async () => {
	await prisma?.$disconnect()
	prisma = undefined
	database?.close()
	database = undefined
	if (temporaryDirectory) {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true })
		temporaryDirectory = undefined
	}
})

test('SQLite migration stores only canonical mirrors in Prisma DateTime representation', async () => {
	temporaryDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'veud-next-release-migration-'),
	)
	const databasePath = path.join(temporaryDirectory, 'fixture.db')
	database = new Database(databasePath)
	database.exec(
		'CREATE TABLE "Media" ("id" TEXT PRIMARY KEY, "nextRelease" TEXT)',
	)
	const insert = database.prepare(
		'INSERT INTO "Media" ("id", "nextRelease") VALUES (?, ?)',
	)
	const rows = [
		['date-only', { releaseDate: '2026-08-03' }],
		['timestamp', { releaseDate: '2026-08-03T18:00:00.123Z' }],
		['pre-epoch', { releaseDate: '1969-12-31T23:59:59.999Z' }],
		['minimum-date', { releaseDate: '0001-01-01' }],
		['maximum-timestamp', { releaseDate: '9999-12-31T23:59:59.999Z' }],
		['numeric-ms', { releaseDate: 1_785_780_000_000 }],
		['overflow-day', { releaseDate: '2026-02-30' }],
		['overflow-time', { releaseDate: '2026-08-03T24:00:00.000Z' }],
		['ambiguous', { releaseDate: '0' }],
		['noncanonical', { releaseDate: '2026-08-03T18:00:00Z' }],
		['numeric-overflow', { releaseDate: 253_402_300_800_000 }],
		['incomplete-source', { releaseDate: '2026-08-03', source: 'tmdb' }],
		[
			'explicit-null-pair',
			{ releaseDate: '2026-08-03', source: null, observedAt: null },
		],
		[
			'invalid-observation',
			{
				releaseDate: '2026-08-03',
				source: 'tmdb',
				observedAt: '2026-02-30T12:00:00.000Z',
			},
		],
		[
			'provider',
			{
				releaseDate: '2026-08-03',
				source: 'tmdb',
				observedAt: '2026-07-28T12:00:00.000Z',
			},
		],
	]
	for (const [id, payload] of rows) insert.run(id, JSON.stringify(payload))
	insert.run('malformed-json', '{')
	insert.run(
		'duplicate-release-last-valid',
		'{"releaseDate":"bad","releaseDate":"2026-08-03"}',
	)
	insert.run(
		'duplicate-release-last-invalid',
		'{"releaseDate":"2026-08-03","releaseDate":"bad"}',
	)
	insert.run(
		'duplicate-provider-last-valid',
		'{"releaseDate":"2026-08-03","source":"other","source":"tmdb","observedAt":"bad","observedAt":"2026-07-28T12:00:00.000Z"}',
	)
	insert.run(
		'duplicate-provider-last-invalid',
		'{"releaseDate":"2026-08-03","source":"tmdb","source":"other","observedAt":"2026-07-28T12:00:00.000Z","observedAt":"bad"}',
	)
	insert.run('high-precision-numeric', '{"releaseDate":1.0000000000000000001}')
	insert.run(
		'huge-duplicate-last-valid',
		'{"releaseDate":1e1000000,"releaseDate":"2026-08-03"}',
	)
	insert.run(
		'huge-duplicate-last-invalid',
		'{"releaseDate":"2026-08-03","releaseDate":1e1000000}',
	)

	database.exec(
		fs.readFileSync(
			new URL(
				'../prisma/migrations/20260728235000_add_next_release_query_mirror/migration.sql',
				import.meta.url,
			),
			'utf8',
		),
	)

	const mirrors = database
		.prepare(
			`SELECT
				"id",
				"nextRelease",
				"nextReleaseAt",
				typeof("nextReleaseAt") AS "storageType"
			 FROM "Media"
			 ORDER BY "id" ASC`,
		)
		.all()
	expect(
		Object.fromEntries(mirrors.map(row => [row.id, row.nextReleaseAt ?? null])),
	).toEqual({
		ambiguous: null,
		'date-only': Date.parse('2026-08-03T00:00:00.000Z'),
		'duplicate-provider-last-invalid': null,
		'duplicate-provider-last-valid': Date.parse('2026-08-03T00:00:00.000Z'),
		'duplicate-release-last-invalid': null,
		'duplicate-release-last-valid': Date.parse('2026-08-03T00:00:00.000Z'),
		'explicit-null-pair': null,
		'high-precision-numeric': 1,
		'huge-duplicate-last-invalid': null,
		'huge-duplicate-last-valid': Date.parse('2026-08-03T00:00:00.000Z'),
		'incomplete-source': null,
		'invalid-observation': null,
		'malformed-json': null,
		'maximum-timestamp': 253_402_300_799_999,
		'minimum-date': -62_135_596_800_000,
		noncanonical: null,
		'numeric-ms': Date.parse('2026-08-03T18:00:00.000Z'),
		'numeric-overflow': null,
		'overflow-day': null,
		'overflow-time': null,
		'pre-epoch': -1,
		provider: Date.parse('2026-08-03T00:00:00.000Z'),
		timestamp: Date.parse('2026-08-03T18:00:00.123Z'),
	})
	expect(
		new Set(
			mirrors
				.filter(row => row.nextReleaseAt !== null)
				.map(row => row.storageType),
		),
	).toEqual(new Set(['integer']))
	expect(mirrors.filter(row => row.nextReleaseAt !== null)).toHaveLength(11)
	for (const row of mirrors) {
		expect(
			row.nextReleaseAt ?? null,
			`SQLite migration diverged from the application parser for ${row.id}`,
		).toBe(deriveNextReleaseAt(row.nextRelease)?.getTime() ?? null)
	}
	expect(
		database
			.prepare(
				`SELECT name FROM sqlite_master
				 WHERE type = 'index' AND name = 'Media_nextReleaseAt_idx'`,
			)
			.get(),
	).toEqual({ name: 'Media_nextReleaseAt_idx' })

	database.close()
	database = undefined
	prisma = new PrismaClient({
		datasourceUrl: `file:${databasePath}`,
	})
	await expect(
		prisma.media.findMany({
			where: {
				nextReleaseAt: {
					gte: new Date('2026-08-03T00:00:00.000Z'),
					lt: new Date('2026-08-04T00:00:00.000Z'),
				},
			},
			orderBy: { id: 'asc' },
			select: { id: true, nextReleaseAt: true },
		}),
	).resolves.toEqual([
		{
			id: 'date-only',
			nextReleaseAt: new Date('2026-08-03T00:00:00.000Z'),
		},
		{
			id: 'duplicate-provider-last-valid',
			nextReleaseAt: new Date('2026-08-03T00:00:00.000Z'),
		},
		{
			id: 'duplicate-release-last-valid',
			nextReleaseAt: new Date('2026-08-03T00:00:00.000Z'),
		},
		{
			id: 'huge-duplicate-last-valid',
			nextReleaseAt: new Date('2026-08-03T00:00:00.000Z'),
		},
		{
			id: 'numeric-ms',
			nextReleaseAt: new Date('2026-08-03T18:00:00.000Z'),
		},
		{
			id: 'provider',
			nextReleaseAt: new Date('2026-08-03T00:00:00.000Z'),
		},
		{
			id: 'timestamp',
			nextReleaseAt: new Date('2026-08-03T18:00:00.123Z'),
		},
	])
})
