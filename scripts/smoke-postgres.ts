#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { searchUsersByUsername } from '#app/utils/user-search.server.ts'

const requiredIndexes = new Set([
	'Media_title_trgm_idx',
	'Media_description_trgm_idx',
	'MediaTitle_normalized_trgm_idx',
])

function assertPostgresUrl(value: string | undefined) {
	if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) {
		throw new Error(
			'DATABASE_URL must point to the disposable PostgreSQL target',
		)
	}
}

async function main() {
	assertPostgresUrl(process.env.DATABASE_URL)
	const prisma = new PrismaClient()
	const suffix = `${Date.now()}-${process.pid}`
	const username = `Postgres_Smoke_${suffix}`
	let userId: string | undefined
	let mediaId: string | undefined

	try {
		const extension = await prisma.$queryRaw<Array<{ installed: boolean }>>`
			SELECT EXISTS (
				SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
			) AS installed
		`
		if (!extension[0]?.installed) throw new Error('pg_trgm is not installed')

		const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
			SELECT indexname
			FROM pg_indexes
			WHERE schemaname = 'public'
		`
		const installedIndexes = new Set(indexes.map(index => index.indexname))
		const missingIndexes = [...requiredIndexes].filter(
			index => !installedIndexes.has(index),
		)
		if (missingIndexes.length) {
			throw new Error(
				`Missing PostgreSQL search indexes: ${missingIndexes.join(', ')}`,
			)
		}

		const user = await prisma.user.create({
			data: {
				email: `${username}@example.com`,
				username,
				name: 'PostgreSQL smoke test',
			},
		})
		userId = user.id
		const media = await prisma.media.create({
			data: {
				kind: 'movie',
				title: 'PostgreSQL Catalog Smoke Test',
				description: 'Temporary provider-scale search verification.',
				titles: {
					create: {
						provider: 'tmdb',
						language: 'en',
						titleType: 'primary',
						value: 'PostgreSQL Catalog Smoke Test',
						normalized: 'postgresql catalog smoke test',
						isPrimary: true,
					},
				},
			},
		})
		mediaId = media.id

		const users = (await searchUsersByUsername(
			prisma,
			'postgres_smoke',
		)) as Array<{ id: string }>
		if (!users.some(candidate => candidate.id === user.id)) {
			throw new Error(
				'Portable user search did not find the smoke-test account',
			)
		}

		const titles = await prisma.mediaTitle.count({
			where: { normalized: { contains: 'catalog smoke' } },
		})
		if (titles < 1) {
			throw new Error('Normalized PostgreSQL catalog search returned no rows')
		}

		console.log(
			'PostgreSQL smoke test passed: schema, pg_trgm indexes, model writes, and portable searches are healthy.',
		)
	} finally {
		if (mediaId) await prisma.media.deleteMany({ where: { id: mediaId } })
		if (userId) await prisma.user.deleteMany({ where: { id: userId } })
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
