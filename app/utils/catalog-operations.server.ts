import { type PrismaClient } from '@prisma/client'

const HOUR_MS = 60 * 60 * 1_000
const RUN_HEARTBEAT_GRACE_MS = 15 * 60 * 1_000
const INVENTORY_FRESHNESS_MS = 36 * HOUR_MS
const RECENT_FAILURE_WINDOW_MS = 24 * HOUR_MS

export const catalogScopes = [
	{ provider: 'tmdb', kind: 'movie', label: 'TMDB movies' },
	{ provider: 'tmdb', kind: 'tv', label: 'TMDB television' },
	{ provider: 'mal', kind: 'anime', label: 'MAL anime' },
	{ provider: 'mal', kind: 'manga', label: 'MAL manga' },
] as const

export type CatalogHealthStatus =
	'healthy' | 'degraded' | 'critical' | 'uninitialized'

export type CatalogHealthIssue = {
	id: string
	severity: 'warning' | 'critical'
	title: string
	detail: string
}

type CatalogRun = {
	id: string
	provider: string
	kind: string
	mode: string
	status: string
	leaseOwner: string
	recordsSeen: number
	recordsHandled: number
	recordsFailed: number
	requestsMade: number
	rateLimitEvents: number
	providerRetryAfter: Date | null
	lastError: string | null
	startedAt: Date
	heartbeatAt: Date
	completedAt: Date | null
}

type CatalogCursor = {
	id: string
	provider: string
	kind: string
	mode: string
	leaseOwner: string | null
	leaseExpiresAt: Date | null
	lastSuccessfulAt: Date | null
	updatedAt: Date
}

export type CatalogCoverage = {
	provider: string
	kind: string
	label: string
	total: number
	active: number
	tombstoned: number
	hydrated: number
	fresh: number
	overdue: number
	queueDepth: number
	failedDeferred: number
	highPriority: number
	coveragePercent: number
	freshnessPercent: number
	requestsMade: number
	rateLimitEvents: number
}

type CatalogHealthInput = {
	now: Date
	coverage: CatalogCoverage[]
	runs: CatalogRun[]
	cursors: CatalogCursor[]
}

function scopeKey(provider: string, kind: string) {
	return `${provider}:${kind}`
}

function jobKey(provider: string, kind: string, mode: string) {
	return `${provider}:${kind}:${mode}`
}

function percent(value: number, total: number) {
	return total ? Math.round((value / total) * 10_000) / 100 : 100
}

function countMap(
	rows: Array<{ provider: string; kind: string; _count: { _all: number } }>,
) {
	return new Map(
		rows.map(row => [scopeKey(row.provider, row.kind), row._count._all]),
	)
}

function rateLimitMap(
	rows: Array<{
		provider: string
		kind: string
		_sum: { requestsMade: number | null; rateLimitEvents: number | null }
	}>,
) {
	return new Map(
		rows.map(row => [
			scopeKey(row.provider, row.kind),
			{
				requestsMade: row._sum.requestsMade ?? 0,
				rateLimitEvents: row._sum.rateLimitEvents ?? 0,
			},
		]),
	)
}

function issue(
	id: string,
	severity: CatalogHealthIssue['severity'],
	title: string,
	detail: string,
): CatalogHealthIssue {
	return { id, severity, title, detail }
}

export function assessCatalogHealth({
	now,
	coverage,
	runs,
	cursors,
}: CatalogHealthInput) {
	if (runs.length === 0 && cursors.length === 0) {
		return {
			status: 'uninitialized' as const,
			issues: [] as CatalogHealthIssue[],
			summary:
				'No catalog sync runs or durable cursors exist in this database.',
		}
	}

	const issues: CatalogHealthIssue[] = []
	const latestRuns = new Map<string, CatalogRun>()
	for (const run of runs) {
		const key = jobKey(run.provider, run.kind, run.mode)
		if (!latestRuns.has(key)) latestRuns.set(key, run)
		if (
			run.status === 'running' &&
			now.getTime() - run.heartbeatAt.getTime() > RUN_HEARTBEAT_GRACE_MS
		) {
			issues.push(
				issue(
					`stale-run:${run.id}`,
					'critical',
					'Sync heartbeat is stale',
					`${run.provider}/${run.kind} ${run.mode} has not checkpointed for more than 15 minutes.`,
				),
			)
		}
		if (run.providerRetryAfter && run.providerRetryAfter > now) {
			issues.push(
				issue(
					`cooldown:${run.id}`,
					'warning',
					'Provider cooldown is active',
					`${run.provider}/${run.kind} will pause requests until ${run.providerRetryAfter.toISOString()}.`,
				),
			)
		}
	}

	for (const run of latestRuns.values()) {
		if (
			run.status === 'failed' &&
			now.getTime() - run.startedAt.getTime() <= RECENT_FAILURE_WINDOW_MS
		) {
			issues.push(
				issue(
					`failed-run:${run.id}`,
					'warning',
					'Latest sync run failed',
					`${run.provider}/${run.kind} ${run.mode}: ${run.lastError ?? 'No error detail was recorded.'}`,
				),
			)
		}
	}

	for (const cursor of cursors) {
		if (
			cursor.leaseOwner &&
			cursor.leaseExpiresAt &&
			cursor.leaseExpiresAt <= now
		) {
			issues.push(
				issue(
					`expired-lease:${cursor.id}`,
					'warning',
					'Expired worker lease remains recorded',
					`${cursor.provider}/${cursor.kind} ${cursor.mode} can be reclaimed safely, but the prior worker may have stopped unexpectedly.`,
				),
			)
		}
		if (
			cursor.mode === 'inventory' &&
			cursor.lastSuccessfulAt &&
			now.getTime() - cursor.lastSuccessfulAt.getTime() > INVENTORY_FRESHNESS_MS
		) {
			issues.push(
				issue(
					`stale-inventory:${cursor.id}`,
					'warning',
					'Inventory refresh is overdue',
					`${cursor.provider}/${cursor.kind} last completed at ${cursor.lastSuccessfulAt.toISOString()}.`,
				),
			)
		}
	}

	for (const item of coverage) {
		const hasHydrationState =
			runs.some(
				run =>
					run.provider === item.provider &&
					run.kind === item.kind &&
					run.mode === 'hydrate',
			) ||
			cursors.some(
				cursor =>
					cursor.provider === item.provider &&
					cursor.kind === item.kind &&
					cursor.mode === 'hydrate',
			)
		if (item.queueDepth > 0 && !hasHydrationState) {
			issues.push(
				issue(
					`unmanaged-queue:${item.provider}:${item.kind}`,
					'warning',
					'Eligible queue has no worker state',
					`${item.label} has ${item.queueDepth.toLocaleString()} eligible records but no hydration run or durable cursor.`,
				),
			)
		}
		const warningThreshold = Math.max(25, Math.ceil(item.active * 0.01))
		if (item.failedDeferred >= warningThreshold) {
			issues.push(
				issue(
					`deferred-failures:${item.provider}:${item.kind}`,
					'warning',
					'Deferred catalog failures are elevated',
					`${item.label} has ${item.failedDeferred.toLocaleString()} deferred failures; review samples before their retry window opens.`,
				),
			)
		}
	}

	const status: CatalogHealthStatus = issues.some(
		item => item.severity === 'critical',
	)
		? 'critical'
		: issues.length
			? 'degraded'
			: 'healthy'
	return {
		status,
		issues,
		summary:
			status === 'healthy'
				? 'Catalog sync telemetry is within the current operating thresholds.'
				: `${issues.length} catalog operations issue${issues.length === 1 ? '' : 's'} require review.`,
	}
}

export async function getCatalogOperationsSnapshot(
	prisma: PrismaClient,
	{ now = new Date(), recentRunLimit = 32 } = {},
) {
	const sourceWhere = {
		provider: { in: ['tmdb', 'mal'] },
		kind: { in: ['movie', 'tv', 'anime', 'manga'] },
	}
	const [
		totalRows,
		activeRows,
		hydratedRows,
		freshRows,
		queueRows,
		deferredRows,
		priorityRows,
		telemetryRows,
		runs,
		cursors,
	] = await Promise.all([
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: sourceWhere,
			_count: { _all: true },
		}),
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: { ...sourceWhere, tombstonedAt: null },
			_count: { _all: true },
		}),
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: {
				...sourceWhere,
				tombstonedAt: null,
				lastFetchedAt: { not: null },
			},
			_count: { _all: true },
		}),
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: {
				...sourceWhere,
				tombstonedAt: null,
				fetchStatus: 'fresh',
				OR: [{ refreshAfter: null }, { refreshAfter: { gt: now } }],
			},
			_count: { _all: true },
		}),
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: {
				...sourceWhere,
				tombstonedAt: null,
				OR: [
					{ fetchStatus: 'pending' },
					{ fetchStatus: 'failed', refreshAfter: { lte: now } },
					{ fetchStatus: 'fresh', refreshAfter: { lte: now } },
				],
			},
			_count: { _all: true },
		}),
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: {
				...sourceWhere,
				tombstonedAt: null,
				fetchStatus: 'failed',
				refreshAfter: { gt: now },
			},
			_count: { _all: true },
		}),
		prisma.mediaExternalId.groupBy({
			by: ['provider', 'kind'],
			where: {
				...sourceWhere,
				tombstonedAt: null,
				hydrationPriority: { gt: 0 },
			},
			_count: { _all: true },
		}),
		prisma.catalogSyncRun.groupBy({
			by: ['provider', 'kind'],
			where: sourceWhere,
			_sum: { requestsMade: true, rateLimitEvents: true },
		}),
		prisma.catalogSyncRun.findMany({
			where: sourceWhere,
			orderBy: { startedAt: 'desc' },
			take: recentRunLimit,
			select: {
				id: true,
				provider: true,
				kind: true,
				mode: true,
				status: true,
				leaseOwner: true,
				recordsSeen: true,
				recordsHandled: true,
				recordsFailed: true,
				requestsMade: true,
				rateLimitEvents: true,
				providerRetryAfter: true,
				lastError: true,
				startedAt: true,
				heartbeatAt: true,
				completedAt: true,
			},
		}),
		prisma.catalogSyncCursor.findMany({
			where: sourceWhere,
			orderBy: [{ provider: 'asc' }, { kind: 'asc' }, { mode: 'asc' }],
			select: {
				id: true,
				provider: true,
				kind: true,
				mode: true,
				leaseOwner: true,
				leaseExpiresAt: true,
				lastSuccessfulAt: true,
				updatedAt: true,
			},
		}),
	])

	const totals = countMap(totalRows)
	const active = countMap(activeRows)
	const hydrated = countMap(hydratedRows)
	const fresh = countMap(freshRows)
	const queued = countMap(queueRows)
	const deferred = countMap(deferredRows)
	const priority = countMap(priorityRows)
	const telemetry = rateLimitMap(telemetryRows)
	const coverage: CatalogCoverage[] = catalogScopes.map(scope => {
		const key = scopeKey(scope.provider, scope.kind)
		const totalCount = totals.get(key) ?? 0
		const activeCount = active.get(key) ?? 0
		const hydratedCount = hydrated.get(key) ?? 0
		const freshCount = fresh.get(key) ?? 0
		const requestTelemetry = telemetry.get(key) ?? {
			requestsMade: 0,
			rateLimitEvents: 0,
		}
		return {
			...scope,
			total: totalCount,
			active: activeCount,
			tombstoned: totalCount - activeCount,
			hydrated: hydratedCount,
			fresh: freshCount,
			overdue: Math.max(0, hydratedCount - freshCount),
			queueDepth: queued.get(key) ?? 0,
			failedDeferred: deferred.get(key) ?? 0,
			highPriority: priority.get(key) ?? 0,
			coveragePercent: percent(hydratedCount, activeCount),
			freshnessPercent: percent(freshCount, activeCount),
			...requestTelemetry,
		}
	})
	const health = assessCatalogHealth({ now, coverage, runs, cursors })
	return {
		generatedAt: now,
		health,
		coverage,
		runs,
		cursors,
	}
}
