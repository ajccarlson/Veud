#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
	applyLibraryImportBatch,
	rollbackLibraryImportBatch,
} from '#app/utils/library-import-commit.server.ts'
import { type LibraryImportItem } from '#app/utils/library-import.ts'
import { publicTrackingStateWhere } from '#app/utils/lists/visibility.ts'
import {
	escapeSqlLikeLiteral,
	prismaSearchFilter,
} from '#app/utils/prisma-search.server.ts'
import { searchUsersByUsername } from '#app/utils/user-search.server.ts'

const requiredIndexes = new Set([
	'Media_title_trgm_idx',
	'Media_description_trgm_idx',
	'MediaTitle_normalized_trgm_idx',
	'Media_nextReleaseAt_idx',
	'ReleaseOccurrence_releaseAt_status_idx',
	'TrackingState_mediaId_idx',
])

function assertPostgresUrl(value: string | undefined) {
	if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) {
		throw new Error(
			'DATABASE_URL must point to the disposable PostgreSQL target',
		)
	}
}

function storedReleaseDate(value: string | null) {
	if (!value) return null
	try {
		const parsed: unknown = JSON.parse(value)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null
		}
		const releaseDate = (parsed as Record<string, unknown>).releaseDate
		return typeof releaseDate === 'string' ? releaseDate : null
	} catch {
		return null
	}
}

async function main() {
	assertPostgresUrl(process.env.DATABASE_URL)
	const prisma = new PrismaClient()
	const suffix = `${Date.now()}-${process.pid}`
	const username = `PostgresSmoke${suffix}`
	const displayName = `PostgreSQL smoke test ${suffix}`
	const collectionTitleMarker = `PostgreSQL Collection Search ${suffix}`
	const collectionDescriptionMarker = `Provider Search Boundary ${suffix}`
	const userIds: string[] = []
	let mediaId: string | undefined
	let cleanupResidueMessage: string | undefined

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
				`Missing required PostgreSQL indexes: ${missingIndexes.join(', ')}`,
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
				select: { id: true, name: true },
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
				name: displayName,
			},
		})
		userIds.push(user.id)
		const releaseObservedAt = new Date()
		const releaseAt = new Date(
			releaseObservedAt.getTime() + 3 * 24 * 60 * 60 * 1_000,
		)
		const media = await prisma.media.create({
			data: {
				kind: 'movie',
				title: `PostgreSQL Catalog Smoke Test 100%_Literal ${suffix}`,
				description: 'Temporary provider-scale search verification.',
				genres: 'Space Opera',
				releaseStatus: 'Planned',
				nextRelease: JSON.stringify({
					releaseDate: releaseAt.toISOString(),
					source: 'tmdb',
					observedAt: releaseObservedAt.toISOString(),
				}),
				nextReleaseAt: releaseAt,
				releaseOccurrences: {
					create: {
						source: 'tmdb',
						sourceKey: `postgres-smoke:${suffix}`,
						eventType: 'release',
						releaseAt,
						observedAt: releaseObservedAt,
						expiresAt: new Date(
							releaseObservedAt.getTime() + 14 * 24 * 60 * 60 * 1_000,
						),
					},
				},
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
		const rangeStart = new Date(releaseAt.getTime() - 60 * 60 * 1_000)
		const rangeEnd = new Date(releaseAt.getTime() + 60 * 60 * 1_000)
		const mirroredMedia = await prisma.media.findMany({
			where: {
				id: media.id,
				nextReleaseAt: { gte: rangeStart, lt: rangeEnd },
			},
			select: { id: true, nextRelease: true, nextReleaseAt: true },
		})
		if (
			mirroredMedia.length !== 1 ||
			mirroredMedia[0]?.id !== media.id ||
			mirroredMedia[0].nextReleaseAt?.getTime() !== releaseAt.getTime() ||
			storedReleaseDate(mirroredMedia[0].nextRelease) !==
				releaseAt.toISOString()
		) {
			throw new Error(
				'Indexed next-release mirror range did not preserve the raw schedule',
			)
		}
		const scheduledOccurrences = await prisma.releaseOccurrence.findMany({
			where: {
				mediaId: media.id,
				status: 'scheduled',
				expiresAt: { gt: releaseObservedAt },
				releaseAt: { gte: rangeStart, lt: rangeEnd },
			},
			select: { mediaId: true, releaseAt: true },
		})
		if (
			scheduledOccurrences.length !== 1 ||
			scheduledOccurrences[0]?.mediaId !== media.id ||
			scheduledOccurrences[0].releaseAt.getTime() !== releaseAt.getTime()
		) {
			throw new Error(
				'Bounded scheduled-occurrence range returned the wrong rows',
			)
		}

		const users = (await searchUsersByUsername(
			prisma,
			`pOsTgReSsMoKe${suffix}`,
		)) as Array<{ id: string }>
		if (!users.some(candidate => candidate.id === user.id)) {
			throw new Error(
				'Portable user search did not find the smoke-test account',
			)
		}
		const mixedCaseDisplayNameMatches = await prisma.user.findMany({
			where: {
				OR: [
					{
						username: prismaSearchFilter(
							'contains',
							'definitely-not-the-username',
						),
					},
					{
						name: prismaSearchFilter(
							'contains',
							`pOsTgReSqL sMoKe TeSt ${suffix}`,
						),
					},
				],
			},
			select: { id: true },
		})
		if (
			mixedCaseDisplayNameMatches.length !== 1 ||
			mixedCaseDisplayNameMatches[0]?.id !== user.id
		) {
			throw new Error(
				'Case-insensitive PostgreSQL moderator-style member search returned the wrong rows',
			)
		}

		const titles = await prisma.mediaTitle.count({
			where: { normalized: { contains: 'catalog smoke' } },
		})
		if (titles < 1) {
			throw new Error('Normalized PostgreSQL catalog search returned no rows')
		}
		const mixedCaseCanonicalMatches = await prisma.media.count({
			where: {
				id: media.id,
				title: prismaSearchFilter('contains', 'pOsTgReSqL cAtAlOg SmOkE'),
			},
		})
		if (mixedCaseCanonicalMatches !== 1) {
			throw new Error(
				'Case-insensitive PostgreSQL canonical-title search returned no rows',
			)
		}
		const exactCanonicalMatches = await prisma.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "Media"
			WHERE "title" ILIKE ${escapeSqlLikeLiteral(
				`pOsTgReSqL cAtAlOg SmOkE tEsT 100%_lItErAl ${suffix}`,
			)} ESCAPE '!'
		`
		if (
			exactCanonicalMatches.length !== 1 ||
			exactCanonicalMatches[0]?.id !== media.id
		) {
			throw new Error(
				'Literal-escaped PostgreSQL exact-title search returned the wrong rows',
			)
		}
		const mixedCaseAlternateMatches = await prisma.mediaTitle.count({
			where: {
				mediaId: media.id,
				normalized: prismaSearchFilter('contains', 'CaTaLoG sMoKe'),
			},
		})
		if (mixedCaseAlternateMatches !== 1) {
			throw new Error(
				'Case-insensitive PostgreSQL alternate-title search returned no rows',
			)
		}
		const mixedCaseGenreContainsMatches = await prisma.media.count({
			where: {
				id: media.id,
				genres: prismaSearchFilter('contains', 'sPaCe OpErA'),
			},
		})
		const mixedCaseSingletonGenreMatches = await prisma.media.count({
			where: {
				id: media.id,
				AND: [
					{ genres: prismaSearchFilter('startsWith', 'sPaCe OpErA') },
					{ genres: prismaSearchFilter('endsWith', 'sPaCe OpErA') },
				],
			},
		})
		if (
			mixedCaseGenreContainsMatches !== 1 ||
			mixedCaseSingletonGenreMatches !== 1
		) {
			throw new Error(
				'Case-insensitive PostgreSQL genre search returned no rows',
			)
		}

		const visibleCollection = await prisma.mediaCollection.create({
			data: {
				ownerId: user.id,
				title: collectionTitleMarker,
				description: collectionDescriptionMarker,
				isPublic: true,
				moderationStatus: 'visible',
			},
			select: { id: true },
		})
		await prisma.mediaCollection.createMany({
			data: [
				{
					ownerId: user.id,
					title: collectionTitleMarker,
					description: collectionDescriptionMarker,
					isPublic: false,
					moderationStatus: 'visible',
				},
				{
					ownerId: user.id,
					title: collectionTitleMarker,
					description: collectionDescriptionMarker,
					isPublic: true,
					moderationStatus: 'hidden',
				},
			],
		})
		const assertVisibleCollectionSearch = async (
			label: string,
			search: Prisma.MediaCollectionWhereInput,
		) => {
			const matches = await prisma.mediaCollection.findMany({
				where: {
					AND: [{ isPublic: true, moderationStatus: 'visible' }, search],
				},
				select: { id: true },
			})
			if (matches.length !== 1 || matches[0]?.id !== visibleCollection.id) {
				throw new Error(
					`Case-insensitive PostgreSQL collection ${label} search escaped its visibility boundary`,
				)
			}
		}
		await assertVisibleCollectionSearch('title', {
			OR: [
				{
					title: prismaSearchFilter(
						'contains',
						`pOsTgReSqL cOlLeCtIoN sEaRcH ${suffix}`,
					),
				},
			],
		})
		await assertVisibleCollectionSearch('description', {
			OR: [
				{
					description: prismaSearchFilter(
						'contains',
						`pRoViDeR sEaRcH bOuNdArY ${suffix}`,
					),
				},
			],
		})
		await assertVisibleCollectionSearch('owner', {
			OR: [
				{
					owner: {
						username: prismaSearchFilter('contains', `pOsTgReSsMoKe${suffix}`),
					},
				},
			],
		})

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

		const liveActionType = listTypes.find(type => type.name === 'liveaction')
		if (!liveActionType) {
			throw new Error('Live-action list type is unavailable')
		}
		const createTracker = async (
			key: string,
			usernameLabel: string,
			nameLabel: string,
		) => {
			const tracker = await prisma.user.create({
				data: {
					email: `postgres-smoke-${key}-${suffix}@example.com`,
					username: `PostgresSmoke${usernameLabel}${suffix}`,
					name: `PostgreSQL ${nameLabel} tracker ${suffix}`,
				},
			})
			userIds.push(tracker.id)
			return tracker
		}
		const publicUnscoredTracker = await createTracker(
			'public-unscored',
			'PublicUnscored',
			'public unscored',
		)
		const privateScoredTracker = await createTracker(
			'private-scored',
			'PrivateScored',
			'private scored',
		)
		const privateUnscoredTracker = await createTracker(
			'private-unscored',
			'PrivateUnscored',
			'private unscored',
		)
		const listlessScoredTracker = await createTracker(
			'listless-scored',
			'ListlessScored',
			'listless scored',
		)
		const listlessUnscoredTracker = await createTracker(
			'listless-unscored',
			'ListlessUnscored',
			'listless unscored',
		)
		const createTrackerWatchlist = (ownerId: string, isPublic: boolean) =>
			prisma.watchlist.create({
				data: {
					ownerId,
					typeId: liveActionType.id,
					name: 'watching',
					header: 'Watching',
					isPublic,
				},
			})
		const publicScoredWatchlist = await createTrackerWatchlist(user.id, true)
		const publicUnscoredWatchlist = await createTrackerWatchlist(
			publicUnscoredTracker.id,
			true,
		)
		const privateScoredWatchlist = await createTrackerWatchlist(
			privateScoredTracker.id,
			false,
		)
		const privateUnscoredWatchlist = await createTrackerWatchlist(
			privateUnscoredTracker.id,
			false,
		)
		await prisma.trackingState.createMany({
			data: [
				{
					ownerId: user.id,
					mediaId: media.id,
					status: 'watching',
					score: 8,
					statusWatchlistId: publicScoredWatchlist.id,
				},
				{
					ownerId: publicUnscoredTracker.id,
					mediaId: media.id,
					status: 'watching',
					score: null,
					statusWatchlistId: publicUnscoredWatchlist.id,
				},
				{
					ownerId: privateScoredTracker.id,
					mediaId: media.id,
					status: 'watching',
					score: 10,
					statusWatchlistId: privateScoredWatchlist.id,
				},
				{
					ownerId: privateUnscoredTracker.id,
					mediaId: media.id,
					status: 'watching',
					score: null,
					statusWatchlistId: privateUnscoredWatchlist.id,
				},
				{
					ownerId: listlessScoredTracker.id,
					mediaId: media.id,
					status: 'watching',
					score: 7,
					statusWatchlistId: null,
				},
				{
					ownerId: listlessUnscoredTracker.id,
					mediaId: media.id,
					status: 'watching',
					score: null,
					statusWatchlistId: null,
				},
			],
		})
		const publicTrackerCounts = await prisma.trackingState.groupBy({
			by: ['mediaId'],
			where: {
				mediaId: {
					in: [media.id, `postgres-smoke-untracked-${suffix}`],
				},
				AND: [publicTrackingStateWhere],
			},
			_count: { _all: true, score: true },
			_avg: { score: true },
		})
		if (
			publicTrackerCounts.length !== 1 ||
			publicTrackerCounts[0]?.mediaId !== media.id ||
			publicTrackerCounts[0]._count._all !== 4 ||
			publicTrackerCounts[0]._count.score !== 2 ||
			Number(publicTrackerCounts[0]._avg.score) !== 7.5
		) {
			throw new Error(
				'Candidate-bounded community aggregates did not preserve public/listless visibility and scored/unscored semantics',
			)
		}

		console.log(
			'PostgreSQL smoke test passed: schema, required indexes, model writes, provider-aware searches, release ranges, community aggregates, visibility boundaries, and atomic import rollback are healthy.',
		)
	} finally {
		if (mediaId) await prisma.media.deleteMany({ where: { id: mediaId } })
		if (userIds.length) {
			await prisma.user.deleteMany({ where: { id: { in: userIds } } })
		}
		const [
			mediaResidue,
			userResidue,
			occurrenceResidue,
			trackingResidue,
			watchlistResidue,
		] = await Promise.all([
			mediaId ? prisma.media.count({ where: { id: mediaId } }) : 0,
			userIds.length
				? prisma.user.count({ where: { id: { in: userIds } } })
				: 0,
			mediaId ? prisma.releaseOccurrence.count({ where: { mediaId } }) : 0,
			mediaId || userIds.length
				? prisma.trackingState.count({
						where: {
							OR: [
								...(mediaId ? [{ mediaId }] : []),
								...(userIds.length ? [{ ownerId: { in: userIds } }] : []),
							],
						},
					})
				: 0,
			userIds.length
				? prisma.watchlist.count({ where: { ownerId: { in: userIds } } })
				: 0,
		])
		await prisma.$disconnect()
		if (
			mediaResidue ||
			userResidue ||
			occurrenceResidue ||
			trackingResidue ||
			watchlistResidue
		) {
			cleanupResidueMessage = `PostgreSQL smoke cleanup left exact-ID residue: media=${mediaResidue}, users=${userResidue}, occurrences=${occurrenceResidue}, tracking=${trackingResidue}, watchlists=${watchlistResidue}`
		}
	}
	if (cleanupResidueMessage) throw new Error(cleanupResidueMessage)
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
