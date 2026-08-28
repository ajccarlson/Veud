#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
	assertPublicSurfaceLoadBudgets,
	assertSafeLoadDatabaseUrl,
} from './postgres-load-utils.mjs'

const args = process.argv.slice(2)
const knownArguments = new Set(['--username', '--report'])

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) throw new Error(`${flag} is required`)
	const value = args[index + 1]
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function assertKnownArguments() {
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index]
		if (!flag || !knownArguments.has(flag)) {
			throw new Error(`Unknown argument: ${flag ?? '(missing)'}`)
		}
		if (!args[index + 1] || args[index + 1]!.startsWith('--')) {
			throw new Error(`${flag} requires a value`)
		}
	}
}

function writePrivateJson(filename: string, value: unknown) {
	fs.mkdirSync(path.dirname(filename), { recursive: true })
	const partial = `${filename}.partial`
	fs.writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	})
	fs.renameSync(partial, filename)
	fs.chmodSync(filename, 0o600)
}

function payloadBytes(value: unknown) {
	return Buffer.byteLength(JSON.stringify(value))
}

async function main() {
	assertKnownArguments()
	assertSafeLoadDatabaseUrl(process.env.DATABASE_URL)
	if (process.env.NODE_ENV !== 'test') {
		throw new Error('Public-surface PostgreSQL smoke must run in test mode')
	}

	const username = valueFor('--username')
	const reportPath = path.resolve(valueFor('--report'))
	const [
		{ prisma },
		anonymousHome,
		trending,
		discovery,
		searchSuggestions,
		publicCache,
		cache,
	] = await Promise.all([
		import('#app/utils/db.server.ts'),
		import('#app/utils/anonymous-home.server.ts'),
		import('#app/utils/home-trending.server.ts'),
		import('#app/utils/discovery.server.ts'),
		import('#app/routes/resources+/search-suggestions.ts'),
		import('#app/utils/public-surface-cache.server.ts'),
		import('#app/utils/cache.server.ts'),
	])

	let activeMeasurement: { queries: number; sqlQueries: number } | null = null
	// Logical queries are counted synchronously in the instrumented delegate, but
	// SQL statements arrive on Prisma's asynchronous `query` event. Reading the
	// counter the instant an operation resolves therefore races the event stream:
	// a statement still in flight is missed, and the handler drops it entirely
	// once the measurement ends. That produced random failures of the
	// `sqlQueries >= logicalQueries` invariant — and, worse, the ceiling budgets
	// compare against the same undercount, so a real regression could pass.
	const DRAIN_MARKER = 'veud-measurement-drain'
	let drainResolve: (() => void) | null = null
	prisma.$on('query', event => {
		if (event.query.includes(DRAIN_MARKER)) {
			drainResolve?.()
			return
		}
		if (activeMeasurement) activeMeasurement.sqlQueries += 1
	})

	/**
	 * Wait until every statement issued so far has been reported. The engine
	 * delivers query events in order, so the arrival of a sentinel issued last
	 * proves the earlier ones already landed. `$queryRawUnsafe` is deliberately
	 * uninstrumented, so the sentinel never inflates the logical count.
	 */
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

	type InstrumentedOperation = (...args: never[]) => unknown
	function instrumentOperation(target: object, operation: string) {
		const delegate = target as Record<string, InstrumentedOperation>
		const original = delegate[operation]
		if (typeof original !== 'function') {
			throw new Error(`Cannot instrument Prisma operation ${operation}`)
		}
		Object.defineProperty(target, operation, {
			configurable: true,
			value: (...operationArgs: never[]) => {
				if (activeMeasurement) activeMeasurement.queries += 1
				return original.apply(target, operationArgs)
			},
		})
	}
	for (const [delegate, operations] of [
		[prisma.media, ['count', 'groupBy', 'findMany']],
		[prisma.review, ['count', 'findMany']],
		[prisma.mediaCollection, ['count', 'findMany']],
		[prisma.activityEvent, ['findMany']],
		[prisma.catalogFeedItem, ['findMany']],
		[prisma.trackingState, ['findMany']],
		[prisma.person, ['findMany']],
		[prisma, ['$queryRaw']],
	] as const) {
		for (const operation of operations) {
			instrumentOperation(delegate, operation)
		}
	}
	let smokeFixture:
		| {
				activityId: string
				reviewId: string
				collectionId: string
		  }
		| undefined

	async function measured<Value>(operation: () => Promise<Value>) {
		if (activeMeasurement) {
			throw new Error('Public-surface measurements may not overlap')
		}
		const measurement = { queries: 0, sqlQueries: 0 }
		activeMeasurement = measurement
		const started = performance.now()
		try {
			const value = await operation()
			// Measure wall time before draining, so the sentinel round trip is not
			// charged to the operation.
			const wallMs = Number((performance.now() - started).toFixed(3))
			await drainQueryEvents()
			return {
				value,
				queries: measurement.queries,
				sqlQueries: measurement.sqlQueries,
				wallMs,
			}
		} finally {
			activeMeasurement = null
		}
	}

	try {
		const viewer = await prisma.user.findUniqueOrThrow({
			where: { username },
			select: { id: true },
		})
		const media = await prisma.media.findFirstOrThrow({
			where: {
				id: { startsWith: 'load-catalog-media-' },
				reviews: { none: { authorId: viewer.id } },
			},
			orderBy: { id: 'asc' },
			select: { id: true },
		})
		const fixtureSuffix = `${process.pid}-${Date.now()}`
		smokeFixture = {
			activityId: `public-smoke-activity-${fixtureSuffix}`,
			reviewId: `public-smoke-review-${fixtureSuffix}`,
			collectionId: `public-smoke-collection-${fixtureSuffix}`,
		}
		const fixtureNow = Date.now()
		await Promise.all([
			prisma.activityEvent.create({
				data: {
					id: smokeFixture.activityId,
					type: 'score',
					score: 8,
					isPublic: true,
					publicEligible: true,
					createdAt: new Date(fixtureNow),
					actorId: viewer.id,
					mediaId: media.id,
				},
			}),
			prisma.review.create({
				data: {
					id: smokeFixture.reviewId,
					body: 'Representative public-surface smoke review.',
					createdAt: new Date(fixtureNow - 1_000),
					authorId: viewer.id,
					mediaId: media.id,
				},
			}),
			prisma.mediaCollection.create({
				data: {
					id: smokeFixture.collectionId,
					title: 'Representative public-surface smoke collection',
					createdAt: new Date(fixtureNow - 2_000),
					ownerId: viewer.id,
				},
			}),
		])

		const anonymousRuntime =
			publicCache.createPublicSurfaceCacheRuntimeForTest()
		const loadAnonymousHome = () =>
			Promise.all([
				anonymousHome.getAnonymousHomeProof({
					cacheRuntime: anonymousRuntime,
				}),
				trending.getHomeTrending(null, { runtime: anonymousRuntime }),
			]).then(([proof, rails]) => ({ proof, rails }))
		const anonymousCold = await measured(loadAnonymousHome)
		const anonymousWarm = await measured(loadAnonymousHome)

		const signedRuntime = publicCache.createPublicSurfaceCacheRuntimeForTest()
		const loadSignedTrending = () =>
			trending.getHomeTrending(viewer.id, { runtime: signedRuntime })
		const signedCold = await measured(loadSignedTrending)
		const signedWarm = await measured(loadSignedTrending)

		const facetsRuntime = publicCache.createPublicSurfaceCacheRuntimeForTest()
		const loadFacets = () =>
			discovery.getDiscoveryFacets({ runtime: facetsRuntime })
		const facetsCold = await measured(loadFacets)
		const facetsWarm = await measured(loadFacets)

		const loadSearchSuggestions = async () => {
			const response = await searchSuggestions.loader({
				request: new Request(
					'http://localhost/resources/search-suggestions?q=Synthetic+Performer+1',
				),
				params: {},
			} as never)
			return response.data
		}
		const searchCold = await measured(loadSearchSuggestions)
		const searchWarm = await measured(loadSearchSuggestions)

		for (const [label, rails] of [
			['anonymous', anonymousCold.value.rails],
			['signed', signedCold.value],
		] as const) {
			if (
				rails.length !== 4 ||
				rails.some(rail => rail.items.length < 1 || rail.items.length > 18)
			) {
				throw new Error(
					`${label} trending did not return four nonempty bounded rails`,
				)
			}
			if (
				rails.some(
					rail =>
						new Set(rail.items.map(item => item.id)).size !== rail.items.length,
				)
			) {
				throw new Error(`${label} trending returned duplicate rail items`)
			}
		}
		if (
			anonymousCold.value.rails.some(rail =>
				rail.items.some(item => item.viewerTracking !== null),
			)
		) {
			throw new Error('Anonymous trending exposed viewer tracking state')
		}
		if (
			!signedCold.value.some(rail =>
				rail.items.some(item => item.viewerTracking !== null),
			)
		) {
			throw new Error(
				'Signed trending did not exercise owner-scoped tracking hydration',
			)
		}
		if (
			anonymousCold.value.proof.catalogTotal < 1 ||
			anonymousCold.value.proof.reviewTotal < 1 ||
			anonymousCold.value.proof.publicCollectionTotal < 1 ||
			anonymousCold.value.proof.activity.length < 1
		) {
			throw new Error(
				'Anonymous home did not exercise catalog, review, collection, and activity data',
			)
		}
		const activityKinds = new Set(
			anonymousCold.value.proof.activity.map(item => item.kind),
		)
		for (const expectedKind of ['tracking', 'review', 'collection'] as const) {
			if (activityKinds.has(expectedKind)) continue
			throw new Error(
				`Anonymous home did not exercise ${expectedKind} activity`,
			)
		}
		if (
			facetsCold.value.genres.length < 1 ||
			facetsCold.value.genres.length > discovery.DISCOVERY_GENRE_LIMIT ||
			facetsCold.value.statuses.length < 1 ||
			facetsCold.value.statuses.length > discovery.DISCOVERY_STATUS_LIMIT
		) {
			throw new Error('Discovery facets were empty or exceeded cardinality')
		}
		if (
			searchCold.value.suggestions.length < 1 ||
			searchCold.value.suggestions.length > 8 ||
			!searchCold.value.suggestions.some(
				item =>
					item.resultType === 'person' &&
					Number.isSafeInteger(item.creditCount) &&
					item.creditCount > 0,
			)
		) {
			throw new Error(
				'Search suggestions did not return a bounded credited person result',
			)
		}

		const report = {
			version: 1,
			measuredAt: new Date().toISOString(),
			anonymousHome: {
				coldQueries: anonymousCold.queries,
				warmQueries: anonymousWarm.queries,
				coldSqlQueries: anonymousCold.sqlQueries,
				warmSqlQueries: anonymousWarm.sqlQueries,
				payloadBytes: payloadBytes(anonymousWarm.value),
				coldWallMs: anonymousCold.wallMs,
				warmWallMs: anonymousWarm.wallMs,
				activityItems: anonymousWarm.value.proof.activity.length,
				railItems: anonymousWarm.value.rails.reduce(
					(total, rail) => total + rail.items.length,
					0,
				),
			},
			signedTrending: {
				coldQueries: signedCold.queries,
				warmQueries: signedWarm.queries,
				coldSqlQueries: signedCold.sqlQueries,
				warmSqlQueries: signedWarm.sqlQueries,
				payloadBytes: payloadBytes(signedWarm.value),
				coldWallMs: signedCold.wallMs,
				warmWallMs: signedWarm.wallMs,
				railItems: signedWarm.value.reduce(
					(total, rail) => total + rail.items.length,
					0,
				),
				trackedItems: signedWarm.value.reduce(
					(total, rail) =>
						total +
						rail.items.filter(item => item.viewerTracking !== null).length,
					0,
				),
			},
			discoveryFacets: {
				coldQueries: facetsCold.queries,
				warmQueries: facetsWarm.queries,
				coldSqlQueries: facetsCold.sqlQueries,
				warmSqlQueries: facetsWarm.sqlQueries,
				payloadBytes: payloadBytes(facetsWarm.value),
				coldWallMs: facetsCold.wallMs,
				warmWallMs: facetsWarm.wallMs,
				genres: facetsWarm.value.genres.length,
				statuses: facetsWarm.value.statuses.length,
				truncated: facetsWarm.value.truncated,
			},
			searchSuggestions: {
				coldQueries: searchCold.queries,
				warmQueries: searchWarm.queries,
				coldSqlQueries: searchCold.sqlQueries,
				warmSqlQueries: searchWarm.sqlQueries,
				payloadBytes: payloadBytes(searchWarm.value),
				coldWallMs: searchCold.wallMs,
				warmWallMs: searchWarm.wallMs,
				items: searchWarm.value.suggestions.length,
				people: searchWarm.value.suggestions.filter(
					item => item.resultType === 'person',
				).length,
			},
			cacheOperations: cache.getCacheOperationsSnapshot(),
		}
		assertPublicSurfaceLoadBudgets(report)
		writePrivateJson(reportPath, report)
		console.log(
			`Public-surface smoke passed: anonymous ${report.anonymousHome.coldQueries}/${report.anonymousHome.warmQueries}, signed trending ${report.signedTrending.coldQueries}/${report.signedTrending.warmQueries}, facets ${report.discoveryFacets.coldQueries}/${report.discoveryFacets.warmQueries}, search ${report.searchSuggestions.coldQueries}/${report.searchSuggestions.warmQueries} cold/warm queries.`,
		)
	} finally {
		if (smokeFixture) {
			await Promise.all([
				prisma.activityEvent.deleteMany({
					where: { id: smokeFixture.activityId },
				}),
				prisma.review.deleteMany({ where: { id: smokeFixture.reviewId } }),
				prisma.mediaCollection.deleteMany({
					where: { id: smokeFixture.collectionId },
				}),
			])
		}
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
