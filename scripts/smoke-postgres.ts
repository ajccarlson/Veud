#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
	applyLibraryImportBatch,
	rollbackLibraryImportBatch,
} from '#app/utils/library-import-commit.server.ts'
import { type LibraryImportItem } from '#app/utils/library-import.ts'
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

		const [roles, permissions, listTypes] = await Promise.all([
			prisma.role.findMany({
				where: {
					name: {
						in: [
							'admin',
							'user',
							'moderator',
							'community-admin',
							'site-operator',
						],
					},
				},
				select: {
					name: true,
					permissions: { select: { action: true, entity: true, access: true } },
				},
			}),
			prisma.permission.count(),
			prisma.listType.findMany({
				where: { name: { in: ['liveaction', 'anime', 'manga'] } },
				select: { name: true },
			}),
		])
		const rolePermissions = new Map(
			roles.map(role => [role.name, role.permissions]),
		)
		const hasPermission = (
			roleName: string,
			action: string,
			entity: string,
			access: string,
		) =>
			rolePermissions
				.get(roleName)
				?.some(
					permission =>
						permission.action === action &&
						permission.entity === entity &&
						permission.access === access,
				) ?? false
		if (
			permissions !== 24 ||
			roles.length !== 5 ||
			rolePermissions.get('user')?.length !== 9 ||
			rolePermissions.get('admin')?.length !== 16 ||
			rolePermissions.get('moderator')?.length !== 5 ||
			rolePermissions.get('community-admin')?.length !== 6 ||
			rolePermissions.get('site-operator')?.length !== 2 ||
			!hasPermission('user', 'create', 'report', 'own') ||
			!hasPermission('moderator', 'moderate', 'content', 'any') ||
			!hasPermission('community-admin', 'assign', 'role', 'any') ||
			!hasPermission('site-operator', 'read', 'operations', 'any') ||
			!hasPermission('site-operator', 'update', 'operations', 'any')
		) {
			throw new Error(
				'Authorization reference data is incomplete; account creation is unsafe',
			)
		}
		if (new Set(listTypes.map(type => type.name)).size !== 3) {
			throw new Error(
				'Media list-type reference data is incomplete; account lists cannot be initialized',
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

		const sourceKey = `postgres-smoke:${suffix}`
		const importItem = {
			sourceKey,
			provider: 'trakt',
			mediaKind: 'movie',
			title: media.title!,
			externalId: null,
			status: 'completed',
			score: 8,
			progress: {},
			repeatCount: 0,
			startedAt: null,
			completedAt: null,
		} satisfies LibraryImportItem
		const importBatch = await prisma.libraryImportBatch.create({
			data: {
				ownerId: user.id,
				provider: 'trakt',
				fileName: 'postgres-smoke.json',
				itemCount: 1,
				matchedCount: 1,
				ambiguousCount: 0,
				unmatchedCount: 0,
				conflictCount: 0,
				items: {
					create: {
						sourceKey,
						payload: JSON.stringify(importItem),
						matchState: 'matched',
						matchMethod: 'exact-title',
						resolution: 'add',
						mediaId: media.id,
					},
				},
			},
		})
		await prisma.$transaction(tx =>
			applyLibraryImportBatch(tx, {
				ownerId: user.id,
				batchId: importBatch.id,
			}),
		)
		const imported = await prisma.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId: user.id, mediaId: media.id } },
		})
		if (imported?.status !== 'completed' || Number(imported.score) !== 8) {
			throw new Error('Atomic library import smoke write was not preserved')
		}
		await prisma.$transaction(tx =>
			rollbackLibraryImportBatch(tx, {
				ownerId: user.id,
				batchId: importBatch.id,
			}),
		)
		if (
			await prisma.trackingState.findUnique({
				where: { ownerId_mediaId: { ownerId: user.id, mediaId: media.id } },
			})
		) {
			throw new Error('Library import smoke rollback left tracking residue')
		}

		console.log(
			'PostgreSQL smoke test passed: schema, pg_trgm indexes, model writes, portable searches, and atomic import rollback are healthy.',
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
