#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { type PrismaClient } from '@prisma/client'
import { type updateEntryCellCommand } from '#app/routes/lists+/.fetch+/update-cell.$request.ts'
import {
	type action as mediaDetailAction,
	type loader as mediaDetailLoader,
} from '#app/routes/media+/$mediaId.tsx'
import {
	type getTrackingActivityState,
	type recordTrackingActivityDiff,
} from '#app/utils/activity.server.ts'
import {
	LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_ID_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_ENTRY_LIMIT,
	LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT,
	LEGACY_TRACKING_STATUS_CODE_UNIT_LIMIT,
} from '#app/utils/legacy-tracking-entry.server.ts'
import { type applyLibraryImportBatch } from '#app/utils/library-import-commit.server.ts'
import { type syncWatchlistActivityVisibility } from '#app/utils/lists/activity-visibility.server.ts'
import { type loadProfileFavorites } from '#app/utils/profile-data.server.ts'
import { type setMediaTrackingStatus } from '#app/utils/tracking-status.server.ts'
import { type serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'
import {
	assertMediaDetailLoadEvidence,
	assertSafeLoadDatabaseUrl,
	summarizeExplain,
} from './postgres-load-utils.mjs'

type ActivityWriter = {
	getTrackingActivityState: typeof getTrackingActivityState
	recordTrackingActivityDiff: typeof recordTrackingActivityDiff
}

type VisibilityWriter = {
	syncWatchlistActivityVisibility: typeof syncWatchlistActivityVisibility
}

type TrackingStatusWriter = {
	setMediaTrackingStatus: typeof setMediaTrackingStatus
}

type LibraryMutex = {
	serializeUserLibraryMutation: typeof serializeUserLibraryMutation
}

type EntryCellWriter = {
	updateEntryCellCommand: typeof updateEntryCellCommand
}

const args = process.argv.slice(2)
const knownArguments = new Set([
	'--username',
	'--expected-entries',
	'--expected-activity',
	'--unsafe-activity-id',
	'--report',
])

function valueFor(flag: string) {
	const index = args.indexOf(flag)
	if (index < 0) throw new Error(`${flag} is required`)
	const value = args[index + 1]
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function positiveInteger(flag: string) {
	const value = Number(valueFor(flag))
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${flag} must be a positive integer`)
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

function compactJson(value: unknown, label: string, byteLimit: number) {
	const encoded = JSON.stringify(value)
	const bytes = Buffer.byteLength(encoded)
	if (bytes > byteLimit) {
		throw new Error(
			`${label} loader payload exceeded ${byteLimit} bytes: ${bytes}`,
		)
	}
	const forbiddenKeys = new Set([
		'entries',
		'history',
		'rawEntries',
		'typedEntries',
		'watchLists',
		'watchlists',
	])
	const stack = [value]
	while (stack.length) {
		const current = stack.pop()
		if (!current || typeof current !== 'object') continue
		if (Array.isArray(current)) {
			stack.push(...current)
			continue
		}
		for (const [key, child] of Object.entries(current)) {
			if (forbiddenKeys.has(key)) {
				throw new Error(`${label} loader exposed forbidden raw field ${key}`)
			}
			stack.push(child)
		}
	}
	return bytes
}

async function measured<T>(operation: () => Promise<T>) {
	const started = performance.now()
	const value = await operation()
	const wallMs = Number((performance.now() - started).toFixed(3))
	if (!Number.isFinite(wallMs) || wallMs < 0 || wallMs >= 20_000) {
		throw new Error(
			`Profile loader timing was invalid or exceeded 20s: ${wallMs}`,
		)
	}
	return { value, wallMs }
}

async function importConcurrencyRegression(
	prisma: PrismaClient,
	applyLibraryImport: typeof applyLibraryImportBatch,
) {
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-smoke-import-owner-${suffix}`
	const mediaIds = [
		`profile-smoke-import-media-${suffix}-1`,
		`profile-smoke-import-media-${suffix}-2`,
	]
	const started = performance.now()
	try {
		await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-smoke-import-${suffix}@synthetic.invalid`,
				username: `profile_smoke_import_${suffix.replaceAll('-', '_')}`,
			},
		})
		const animeType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'anime' },
			select: { id: true },
		})
		await prisma.media.createMany({
			data: mediaIds.map((id, index) => ({
				id,
				kind: 'anime',
				title: `Profile import concurrency fixture ${index + 1}`,
				catalogProvenanceVersion: 1,
			})),
		})
		const batches = await Promise.all(
			mediaIds.map((mediaId, index) =>
				prisma.libraryImportBatch.create({
					data: {
						ownerId,
						provider: 'myanimelist',
						fileName: `concurrency-${index + 1}.xml`,
						itemCount: 1,
						matchedCount: 1,
						ambiguousCount: 0,
						unmatchedCount: 0,
						conflictCount: 0,
						items: {
							create: {
								sourceKey: `mal:anime:concurrency:${suffix}:${index + 1}`,
								mediaId,
								resolution: 'add',
								matchState: 'matched',
								matchMethod: 'exact-title',
								payload: JSON.stringify({
									sourceKey: `mal:anime:concurrency:${suffix}:${index + 1}`,
									provider: 'myanimelist',
									mediaKind: 'anime',
									title: `Profile import concurrency fixture ${index + 1}`,
									externalId: null,
									status: 'completed',
									score: 8,
									progress: { episodes: 12 },
									repeatCount: 0,
									startedAt: null,
									completedAt: null,
								}),
							},
						},
					},
					select: { id: true },
				}),
			),
		)

		const results = await Promise.all(
			batches.map(batch =>
				prisma.$transaction(
					tx =>
						applyLibraryImport(tx, {
							ownerId,
							batchId: batch.id,
						}),
					{ maxWait: 10_000, timeout: 30_000 },
				),
			),
		)
		const [destinationLists, states, entries] = await Promise.all([
			prisma.watchlist.findMany({
				where: { ownerId, typeId: animeType.id, name: 'completed' },
				select: { id: true },
			}),
			prisma.trackingState.findMany({
				where: { ownerId, mediaId: { in: mediaIds } },
				select: { statusWatchlistId: true },
			}),
			prisma.entry.count({
				where: { watchlist: { ownerId }, mediaId: { in: mediaIds } },
			}),
		])
		if (
			results.some(result => result.appliedCount !== 1) ||
			destinationLists.length !== 1 ||
			states.length !== 2 ||
			states.some(
				state => state.statusWatchlistId !== destinationLists[0]?.id,
			) ||
			entries !== 2
		) {
			throw new Error(
				'Concurrent imports did not reuse exactly one serialized status list',
			)
		}
		return {
			concurrentImports: results.length,
			destinationLists: destinationLists.length,
			trackingStates: states.length,
			entries,
			wallMs: Number((performance.now() - started).toFixed(3)),
		}
	} finally {
		await prisma.user.deleteMany({ where: { id: ownerId } })
		await prisma.media.deleteMany({ where: { id: { in: mediaIds } } })
	}
}

async function scoreStatusMutexOrderRegression(
	prisma: PrismaClient,
	action: typeof mediaDetailAction,
	trackingStatus: TrackingStatusWriter,
	mutex: LibraryMutex,
) {
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-smoke-order-owner-${suffix}`
	const mediaId = `profile-smoke-order-media-${suffix}`
	let releaseStatus = () => {}
	const pendingOperations: Promise<unknown>[] = []
	try {
		const owner = await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-smoke-order-${suffix}@synthetic.invalid`,
				username: `profile_smoke_order_${suffix.replaceAll('-', '_')}`,
				lastActiveAt: new Date(),
			},
		})
		const liveActionType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'liveaction' },
			select: { id: true },
		})
		const [source, destination] = await Promise.all([
			prisma.watchlist.create({
				data: {
					ownerId,
					typeId: liveActionType.id,
					name: 'watching',
					header: 'Watching',
					position: 1,
					isPublic: true,
				},
			}),
			prisma.watchlist.create({
				data: {
					ownerId,
					typeId: liveActionType.id,
					name: 'completed',
					header: 'Completed',
					position: 2,
					isPublic: true,
				},
			}),
		])
		await prisma.media.create({
			data: {
				id: mediaId,
				kind: 'movie',
				title: 'Mutex order fixture',
				catalogProvenanceVersion: 1,
			},
		})
		const state = await prisma.trackingState.create({
			data: {
				ownerId,
				mediaId,
				status: source.name,
				statusWatchlistId: source.id,
				score: 6,
			},
		})
		await prisma.entry.create({
			data: {
				watchlistId: source.id,
				mediaId,
				trackingStateId: state.id,
				position: 1,
				title: 'Mutex order fixture',
				type: 'Movie',
				personal: 6,
			},
		})
		const session = await prisma.session.create({
			data: {
				userId: owner.id,
				expirationDate: new Date(Date.now() + 60_000),
			},
		})
		const { authSessionStorage } = await import('#app/utils/session.server.ts')
		const cookieSession = await authSessionStorage.getSession()
		cookieSession.set('sessionId', session.id)
		const cookie = (
			await authSessionStorage.commitSession(cookieSession)
		).split(';')[0]!

		let signalStatusLocked = () => {}
		const statusLocked = new Promise<void>(resolve => {
			signalStatusLocked = resolve
		})
		const holdStatus = new Promise<void>(resolve => {
			releaseStatus = resolve
		})
		const statusTransaction = prisma.$transaction(
			async tx => {
				await mutex.serializeUserLibraryMutation(tx, ownerId)
				signalStatusLocked()
				await holdStatus
				await trackingStatus.setMediaTrackingStatus(tx, {
					ownerId,
					mediaId,
					watchlistId: destination.id,
				})
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		pendingOperations.push(statusTransaction)
		await statusLocked

		const scoreResult = action({
			request: new Request(
				`https://profile-smoke.invalid/media/${encodeURIComponent(mediaId)}`,
				{
					method: 'POST',
					headers: {
						cookie,
						'content-type': 'application/x-www-form-urlencoded',
					},
					body: new URLSearchParams({ intent: 'score', score: '9' }),
				},
			),
			params: { mediaId },
		} as unknown as Parameters<typeof action>[0]).then(
			value => ({ value, error: null }),
			error => ({ value: null, error }),
		)
		pendingOperations.push(scoreResult)

		await new Promise(resolve => setTimeout(resolve, 200))
		const trackingRowWasFree = await prisma
			.$transaction(async tx => {
				await tx.$queryRaw`
					SELECT "id"
					FROM "TrackingState"
					WHERE "id" = ${state.id}
					FOR UPDATE NOWAIT
				`
			})
			.then(
				() => true,
				() => false,
			)
		if (!trackingRowWasFree) {
			throw new Error(
				'Score update locked TrackingState before acquiring the user mutex',
			)
		}

		releaseStatus()
		const [statusUpdate, scoreUpdate] = await Promise.all([
			statusTransaction,
			scoreResult,
		])
		void statusUpdate
		if (scoreUpdate.error) throw scoreUpdate.error
		const saved = await prisma.trackingState.findUniqueOrThrow({
			where: { id: state.id },
			select: { statusWatchlistId: true, score: true },
		})
		if (
			saved.statusWatchlistId !== destination.id ||
			Number(saved.score) !== 9
		) {
			throw new Error(
				'Serialized status and score updates did not both commit correctly',
			)
		}
		return {
			trackingRowFreeWhileScoreWaited: trackingRowWasFree,
			statusAndScoreCommitted: true,
		}
	} finally {
		releaseStatus()
		await Promise.allSettled(pendingOperations)
		await prisma.user.deleteMany({ where: { id: ownerId } })
		await prisma.media.deleteMany({ where: { id: mediaId } })
	}
}

async function cellHistoryMutexRegression(
	prisma: PrismaClient,
	cellWriter: EntryCellWriter,
	mutex: LibraryMutex,
) {
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-smoke-cell-owner-${suffix}`
	const listTypeId = `profile-smoke-cell-type-${suffix}`
	const entryId = `profile-smoke-cell-entry-${suffix}`
	let releaseWriter = () => {}
	const pendingOperations: Promise<unknown>[] = []
	try {
		await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-smoke-cell-${suffix}@synthetic.invalid`,
				username: `profile_smoke_cell_${suffix.replaceAll('-', '_')}`,
			},
		})
		await prisma.listType.create({
			data: {
				id: listTypeId,
				name: `profile-smoke-cell-${suffix}`,
				header: 'Cell history regression',
				columns: JSON.stringify({ title: 'string' }),
				mediaType: JSON.stringify(['movie']),
				completionType: JSON.stringify({ past: 'watched' }),
			},
		})
		const watchlist = await prisma.watchlist.create({
			data: {
				ownerId,
				typeId: listTypeId,
				name: 'watching',
				header: 'Watching',
				position: 1,
			},
		})
		await prisma.entry.create({
			data: {
				id: entryId,
				watchlistId: watchlist.id,
				position: 1,
				title: 'Before',
				history: JSON.stringify({ added: 1, progress: { episode: 1 } }),
			},
		})

		let signalWriterLocked = () => {}
		const writerLocked = new Promise<void>(resolve => {
			signalWriterLocked = resolve
		})
		const holdWriter = new Promise<void>(resolve => {
			releaseWriter = resolve
		})
		const historyWriter = prisma.$transaction(
			async tx => {
				await mutex.serializeUserLibraryMutation(tx, ownerId)
				await tx.entry.update({
					where: { id: entryId },
					data: {
						history: JSON.stringify({
							added: 1,
							progress: { episode: 7 },
							concurrentMarker: 'preserve-me',
						}),
					},
				})
				signalWriterLocked()
				await holdWriter
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		pendingOperations.push(historyWriter)
		await writerLocked

		const cellUpdate = cellWriter.updateEntryCellCommand(ownerId, {
			entryId,
			columnId: 'title',
			value: 'After',
		})
		pendingOperations.push(cellUpdate)
		await new Promise(resolve => setTimeout(resolve, 200))
		releaseWriter()
		await Promise.all([historyWriter, cellUpdate])

		const saved = await prisma.entry.findUniqueOrThrow({
			where: { id: entryId },
			select: { title: true, history: true },
		})
		const history = JSON.parse(saved.history ?? '') as {
			progress?: { episode?: number }
			concurrentMarker?: string
		}
		if (
			saved.title !== 'After' ||
			history.progress?.episode !== 7 ||
			history.concurrentMarker !== 'preserve-me'
		) {
			throw new Error(
				'Cell update overwrote history committed while it waited for the user mutex',
			)
		}
		return {
			concurrentHistoryPreserved: true,
			titleCommitted: true,
		}
	} finally {
		releaseWriter()
		await Promise.allSettled(pendingOperations)
		await prisma.user.deleteMany({ where: { id: ownerId } })
		await prisma.listType.deleteMany({ where: { id: listTypeId } })
	}
}

async function activityMultiOperationConcurrencyRegression(
	prisma: PrismaClient,
	activity: ActivityWriter,
) {
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-smoke-multi-owner-${suffix}`
	const mediaIds = [
		`profile-smoke-multi-media-a-${suffix}`,
		`profile-smoke-multi-media-b-${suffix}`,
	]
	let releaseFirst = () => {}
	try {
		await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-smoke-multi-${suffix}@synthetic.invalid`,
				username: `profile_smoke_multi_${suffix.replaceAll('-', '_')}`,
			},
		})
		const liveActionType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'liveaction' },
			select: { id: true },
		})
		const watchlists = await Promise.all([
			prisma.watchlist.create({
				data: {
					ownerId,
					typeId: liveActionType.id,
					name: 'watching-a',
					header: 'Watching A',
					position: 1,
					isPublic: true,
				},
			}),
			prisma.watchlist.create({
				data: {
					ownerId,
					typeId: liveActionType.id,
					name: 'watching-b',
					header: 'Watching B',
					position: 2,
					isPublic: true,
				},
			}),
		])
		await prisma.media.createMany({
			data: mediaIds.map((id, index) => ({
				id,
				kind: 'movie',
				title: `Multi-operation activity ${index + 1}`,
				catalogProvenanceVersion: 1,
			})),
		})
		await prisma.trackingState.createMany({
			data: mediaIds.map((mediaId, index) => ({
				ownerId,
				mediaId,
				status: watchlists[index]!.name,
				statusWatchlistId: watchlists[index]!.id,
				score: 8 + index,
			})),
		})

		const record = async (
			tx: Parameters<typeof activity.recordTrackingActivityDiff>[0],
			mediaId: string,
		) => {
			const after = await activity.getTrackingActivityState(
				tx,
				ownerId,
				mediaId,
			)
			if (!after) throw new Error('Multi-operation tracking state is missing')
			await activity.recordTrackingActivityDiff(tx, {
				actorId: ownerId,
				mediaId,
				before: { ...after, score: null },
				after,
			})
		}

		let signalFirstRecorded = () => {}
		const firstRecorded = new Promise<void>(resolve => {
			signalFirstRecorded = resolve
		})
		const holdFirst = new Promise<void>(resolve => {
			releaseFirst = resolve
		})
		const descending = prisma.$transaction(
			async tx => {
				await record(tx, mediaIds[1]!)
				signalFirstRecorded()
				await holdFirst
				await record(tx, mediaIds[0]!)
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		await firstRecorded

		let signalAttempted = () => {}
		let signalFirstRecordedAscending = () => {}
		const attempted = new Promise<void>(resolve => {
			signalAttempted = resolve
		})
		const firstRecordedAscending = new Promise<void>(resolve => {
			signalFirstRecordedAscending = resolve
		})
		const ascending = prisma.$transaction(
			async tx => {
				signalAttempted()
				await record(tx, mediaIds[0]!)
				signalFirstRecordedAscending()
				await record(tx, mediaIds[1]!)
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		await attempted
		const bypassedActorLock = await Promise.race([
			firstRecordedAscending.then(() => true),
			new Promise<false>(resolve => setTimeout(() => resolve(false), 200)),
		])
		releaseFirst()
		await Promise.all([descending, ascending])
		if (bypassedActorLock) {
			throw new Error(
				'Opposite-order activity transactions bypassed the actor mutex',
			)
		}
		const eventCount = await prisma.activityEvent.count({
			where: { actorId: ownerId, mediaId: { in: mediaIds }, type: 'score' },
		})
		if (eventCount !== 4) {
			throw new Error(
				`Opposite-order activity transactions stored ${eventCount} events; expected 4`,
			)
		}
		return { secondTransactionBlocked: true, eventCount }
	} finally {
		releaseFirst()
		await prisma.user.deleteMany({ where: { id: ownerId } })
		await prisma.media.deleteMany({ where: { id: { in: mediaIds } } })
	}
}

async function activityVisibilityConcurrencyRegression(
	prisma: PrismaClient,
	activity: ActivityWriter,
	visibility: VisibilityWriter,
) {
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-smoke-activity-owner-${suffix}`
	const mediaId = `profile-smoke-activity-media-${suffix}`
	let releaseActivity = () => {}
	try {
		await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-smoke-activity-${suffix}@synthetic.invalid`,
				username: `profile_smoke_activity_${suffix.replaceAll('-', '_')}`,
			},
		})
		const liveActionType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'liveaction' },
			select: { id: true },
		})
		const watchlist = await prisma.watchlist.create({
			data: {
				ownerId,
				typeId: liveActionType.id,
				name: 'watching',
				header: 'Watching',
				position: 1,
				isPublic: true,
			},
		})
		await prisma.media.create({
			data: {
				id: mediaId,
				kind: 'movie',
				title: 'Visibility race fixture',
				catalogProvenanceVersion: 1,
			},
		})
		await prisma.trackingState.create({
			data: {
				ownerId,
				mediaId,
				status: 'watching',
				statusWatchlistId: watchlist.id,
				score: 8,
			},
		})

		let signalInserted = () => {}
		const inserted = new Promise<void>(resolve => {
			signalInserted = resolve
		})
		const holdActivity = new Promise<void>(resolve => {
			releaseActivity = resolve
		})
		const activityTransaction = prisma.$transaction(
			async tx => {
				const after = await activity.getTrackingActivityState(
					tx,
					ownerId,
					mediaId,
				)
				if (!after) throw new Error('Visibility race tracking state is missing')
				await activity.recordTrackingActivityDiff(tx, {
					actorId: ownerId,
					mediaId,
					before: { ...after, score: null },
					after,
				})
				signalInserted()
				await holdActivity
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		await inserted

		let signalAttempted = () => {}
		let signalSynchronized = () => {}
		const attempted = new Promise<void>(resolve => {
			signalAttempted = resolve
		})
		const synchronized = new Promise<void>(resolve => {
			signalSynchronized = resolve
		})
		const visibilityTransaction = prisma.$transaction(
			async tx => {
				signalAttempted()
				const updated = await tx.watchlist.update({
					where: { id: watchlist.id },
					data: { isPublic: false },
				})
				await visibility.syncWatchlistActivityVisibility(tx, updated)
				signalSynchronized()
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		await attempted
		const settingsPassedWhileActivityWasUncommitted = await Promise.race([
			synchronized.then(() => true),
			new Promise<false>(resolve => setTimeout(() => resolve(false), 200)),
		])
		releaseActivity()
		await Promise.all([activityTransaction, visibilityTransaction])
		if (settingsPassedWhileActivityWasUncommitted) {
			throw new Error(
				'Watchlist visibility update bypassed the activity provenance lock',
			)
		}

		const event = await prisma.activityEvent.findFirstOrThrow({
			where: { actorId: ownerId, mediaId, type: 'score' },
			select: { isPublic: true, publicEligible: true, statusLabel: true },
		})
		if (
			event.isPublic ||
			!event.publicEligible ||
			event.statusLabel !== watchlist.header
		) {
			throw new Error(
				'Concurrent privatization did not hide the committed activity event',
			)
		}
		return {
			settingsBlockedOnActivityLock: true,
			eventPublicAfterPrivatization: event.isPublic,
			eventRemainsEligibleForItsOriginalPublicContext: event.publicEligible,
		}
	} finally {
		releaseActivity()
		await prisma.user.deleteMany({ where: { id: ownerId } })
		await prisma.media.deleteMany({ where: { id: mediaId } })
	}
}

async function activityDeletionConcurrencyRegression(
	prisma: PrismaClient,
	activity: ActivityWriter,
	visibility: VisibilityWriter,
) {
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-smoke-delete-owner-${suffix}`
	const mediaId = `profile-smoke-delete-media-${suffix}`
	let releaseActivity = () => {}
	try {
		await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-smoke-delete-${suffix}@synthetic.invalid`,
				username: `profile_smoke_delete_${suffix.replaceAll('-', '_')}`,
			},
		})
		const liveActionType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'liveaction' },
			select: { id: true },
		})
		const watchlist = await prisma.watchlist.create({
			data: {
				ownerId,
				typeId: liveActionType.id,
				name: 'watching',
				header: 'Watching',
				position: 1,
				isPublic: true,
			},
		})
		await prisma.media.create({
			data: {
				id: mediaId,
				kind: 'movie',
				title: 'Deletion race fixture',
				catalogProvenanceVersion: 1,
			},
		})
		await prisma.trackingState.create({
			data: {
				ownerId,
				mediaId,
				status: 'watching',
				statusWatchlistId: watchlist.id,
				score: 7,
			},
		})

		let signalInserted = () => {}
		const inserted = new Promise<void>(resolve => {
			signalInserted = resolve
		})
		const holdActivity = new Promise<void>(resolve => {
			releaseActivity = resolve
		})
		const activityTransaction = prisma.$transaction(
			async tx => {
				const after = await activity.getTrackingActivityState(
					tx,
					ownerId,
					mediaId,
				)
				if (!after) throw new Error('Deletion race tracking state is missing')
				await activity.recordTrackingActivityDiff(tx, {
					actorId: ownerId,
					mediaId,
					before: { ...after, score: null },
					after,
				})
				signalInserted()
				await holdActivity
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		await inserted

		let signalAttempted = () => {}
		let signalDeleted = () => {}
		const attempted = new Promise<void>(resolve => {
			signalAttempted = resolve
		})
		const deleted = new Promise<void>(resolve => {
			signalDeleted = resolve
		})
		const deletionTransaction = prisma.$transaction(
			async tx => {
				signalAttempted()
				await visibility.syncWatchlistActivityVisibility(tx, {
					...watchlist,
					isPublic: false,
				})
				await tx.watchlist.delete({ where: { id: watchlist.id } })
				signalDeleted()
			},
			{ maxWait: 10_000, timeout: 30_000 },
		)
		await attempted
		const deletedBeforeActivityCommitted = await Promise.race([
			deleted.then(() => true),
			new Promise<false>(resolve => setTimeout(() => resolve(false), 200)),
		])
		releaseActivity()
		await Promise.all([activityTransaction, deletionTransaction])
		if (deletedBeforeActivityCommitted) {
			throw new Error('Watchlist deletion bypassed the activity actor mutex')
		}

		const event = await prisma.activityEvent.findFirstOrThrow({
			where: { actorId: ownerId, mediaId, type: 'score' },
			select: {
				isPublic: true,
				publicEligible: true,
				statusLabel: true,
				statusWatchlistId: true,
			},
		})
		if (
			event.isPublic ||
			!event.publicEligible ||
			event.statusWatchlistId !== null ||
			event.statusLabel !== watchlist.header
		) {
			throw new Error(
				'Concurrent deletion did not quarantine activity before clearing its relation',
			)
		}
		return {
			deletionBlockedOnActorMutex: true,
			eventPublicAfterDeletion: event.isPublic,
			relationClearedAfterQuarantine: event.statusWatchlistId === null,
		}
	} finally {
		releaseActivity()
		await prisma.user.deleteMany({ where: { id: ownerId } })
		await prisma.media.deleteMany({ where: { id: mediaId } })
	}
}

const mediaProvenanceFixturePrefix = 'profile-media-provenance-smoke-'
const privateCatalogSentinel =
	'PRIVATE MEMBER CATALOG SNAPSHOT MUST NEVER ESCAPE'
const mediaProvenanceFanoutLimit = 256

async function cleanupMediaProvenanceFixtures(prisma: PrismaClient) {
	await prisma.activityEvent.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.reviewComment.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.review.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.follow.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.session.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.userFavorite.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.entry.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.trackingState.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.watchlist.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})
	await prisma.media.deleteMany({
		where: { id: { startsWith: mediaProvenanceFixturePrefix } },
	})

	const [
		activityRows,
		commentRows,
		reviewRows,
		followRows,
		sessionRows,
		favoriteRows,
		entryRows,
		trackingRows,
		watchlistRows,
		mediaRows,
	] = await Promise.all([
		prisma.activityEvent.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.reviewComment.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.review.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.follow.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.session.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.userFavorite.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.entry.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.trackingState.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.watchlist.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
		prisma.media.count({
			where: { id: { startsWith: mediaProvenanceFixturePrefix } },
		}),
	])
	const residue = {
		activityRows,
		commentRows,
		reviewRows,
		followRows,
		sessionRows,
		favoriteRows,
		entryRows,
		trackingRows,
		watchlistRows,
		mediaRows,
	}
	const nonZero = Object.entries(residue).filter(([, count]) => count !== 0)
	if (nonZero.length) {
		throw new Error(
			`Media provenance fixture cleanup left residue: ${nonZero
				.map(([name, count]) => `${name}=${count}`)
				.join(', ')}`,
		)
	}
}

type MediaProvenanceFixture = {
	mediaId: string
	viewerId: string
	sessionId: string
	legacyViewerId: string
	legacyViewerUsername: string
	legacySessionId: string
	representativeMembers: number
	fanoutEntries: number
	privateEntries: number
	hostileHistoryCodeUnits: number
	hostileCounterCodeUnits: number
	realNames: string[]
}

async function createMediaProvenanceFixture(
	prisma: PrismaClient,
): Promise<MediaProvenanceFixture> {
	await cleanupMediaProvenanceFixtures(prisma)
	const representatives = await prisma.user.findMany({
		where: { id: { startsWith: 'load-catalog-member-' } },
		orderBy: [{ username: 'asc' }],
		take: mediaProvenanceFanoutLimit,
		select: {
			id: true,
			username: true,
			name: true,
		},
	})
	if (representatives.length < 6) {
		throw new Error(
			'Media provenance smoke requires at least six representative members',
		)
	}
	const viewer =
		representatives.find(
			representative => representative.username === 'load_catalog_member_1',
		) ?? representatives[0]!
	const followed = representatives.find(
		representative => representative.id !== viewer.id,
	)!
	const reviewAuthor = representatives.find(
		representative =>
			representative.id !== viewer.id && representative.id !== followed.id,
	)!
	const activityActor = representatives.find(
		representative =>
			representative.id !== viewer.id &&
			representative.id !== followed.id &&
			representative.id !== reviewAuthor.id,
	)!
	const commentAuthor = representatives.find(
		representative =>
			representative.id !== viewer.id &&
			representative.id !== followed.id &&
			representative.id !== reviewAuthor.id &&
			representative.id !== activityActor.id,
	)!
	const legacyViewer = representatives.find(
		representative =>
			representative.id !== viewer.id &&
			representative.id !== followed.id &&
			representative.id !== reviewAuthor.id &&
			representative.id !== activityActor.id &&
			representative.id !== commentAuthor.id,
	)!
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'liveaction' },
		select: { id: true },
	})
	const suffix = `${process.pid}-${Date.now()}`
	const mediaId = `${mediaProvenanceFixturePrefix}media-${suffix}`
	const safeOwnerId = (ownerId: string) =>
		ownerId.replaceAll(/[^a-zA-Z0-9_-]/g, '_')
	const watchlistId = (ownerId: string) =>
		`${mediaProvenanceFixturePrefix}watchlist-${suffix}-${safeOwnerId(ownerId)}`
	const entryId = (ownerId: string) =>
		`${mediaProvenanceFixturePrefix}entry-${suffix}-${safeOwnerId(ownerId)}`
	const hostileHistory = `${privateCatalogSentinel} hostile history `.padEnd(
		1024 * 1024,
		'x',
	)
	const hostileCounter = `${privateCatalogSentinel} hostile counter `.padEnd(
		1024 * 1024,
		'9',
	)

	await prisma.media.create({
		data: {
			id: mediaId,
			kind: 'movie',
			catalogProvenanceVersion: 1,
		},
	})
	await prisma.watchlist.createMany({
		data: representatives.map((representative, index) => ({
			id: watchlistId(representative.id),
			ownerId: representative.id,
			typeId: listType.id,
			position: 90 + index,
			name: `provenance-${suffix}`,
			header: 'Private provenance fixture',
			isPublic: representative.id === followed.id,
		})),
	})
	await prisma.entry.createMany({
		data: representatives.map((representative, index) => ({
			id: entryId(representative.id),
			watchlistId: watchlistId(representative.id),
			mediaId,
			position: 1,
			title: `${privateCatalogSentinel} title ${index + 1}`,
			description: `${privateCatalogSentinel} description ${index + 1}`,
			thumbnail: `https://private.invalid/${suffix}/${index + 1}.jpg`,
			genres: `${privateCatalogSentinel}, private genre`,
			type: 'Movie',
			length: '1 / 120 min',
			personal: 7,
			history: JSON.stringify({
				started: Date.UTC(2026, 0, 1),
				lastUpdated: Date.UTC(2026, 0, 2) + index,
			}),
		})),
	})
	await prisma.entry.update({
		where: { id: entryId(legacyViewer.id) },
		data: {
			history: hostileHistory,
			length: hostileCounter,
		},
	})
	await prisma.trackingState.createMany({
		data: [
			{
				id: `${mediaProvenanceFixturePrefix}tracking-viewer-${suffix}`,
				ownerId: viewer.id,
				mediaId,
				status: 'watching',
				statusWatchlistId: watchlistId(viewer.id),
				score: 8,
			},
			{
				id: `${mediaProvenanceFixturePrefix}tracking-followed-${suffix}`,
				ownerId: followed.id,
				mediaId,
				status: 'watching',
				statusWatchlistId: watchlistId(followed.id),
				score: 7,
			},
		],
	})
	await prisma.follow.create({
		data: {
			id: `${mediaProvenanceFixturePrefix}follow-${suffix}`,
			followerId: viewer.id,
			followingId: followed.id,
		},
	})
	await prisma.userFavorite.create({
		data: {
			id: `${mediaProvenanceFixturePrefix}favorite-${suffix}`,
			ownerId: legacyViewer.id,
			typeId: listType.id,
			mediaId,
			position: 1,
			title: `${privateCatalogSentinel} historical favorite title`,
			thumbnail: `https://private.invalid/${suffix}/favorite.jpg`,
			mediaType: `${privateCatalogSentinel} historical favorite type`,
			startYear: `${privateCatalogSentinel} historical favorite year`,
		},
	})
	const review = await prisma.review.create({
		data: {
			id: `${mediaProvenanceFixturePrefix}review-${suffix}`,
			authorId: reviewAuthor.id,
			mediaId,
			body: 'Representative public review for media provenance smoke.',
			rating: 8,
		},
		select: { id: true },
	})
	await prisma.reviewComment.create({
		data: {
			id: `${mediaProvenanceFixturePrefix}comment-${suffix}`,
			reviewId: review.id,
			authorId: commentAuthor.id,
			body: 'Representative public comment for media provenance smoke.',
		},
	})
	await prisma.activityEvent.create({
		data: {
			id: `${mediaProvenanceFixturePrefix}activity-${suffix}`,
			actorId: activityActor.id,
			mediaId,
			type: 'score',
			score: 8,
			isPublic: true,
			publicEligible: true,
		},
	})
	const sessionId = `${mediaProvenanceFixturePrefix}session-${suffix}`
	const legacySessionId = `${mediaProvenanceFixturePrefix}session-legacy-${suffix}`
	await prisma.session.createMany({
		data: [
			{
				id: sessionId,
				userId: viewer.id,
				expirationDate: new Date(Date.now() + 10 * 60_000),
			},
			{
				id: legacySessionId,
				userId: legacyViewer.id,
				expirationDate: new Date(Date.now() + 10 * 60_000),
			},
		],
	})
	await prisma.$executeRawUnsafe('ANALYZE "Entry"')

	return {
		mediaId,
		viewerId: viewer.id,
		sessionId,
		legacyViewerId: legacyViewer.id,
		legacyViewerUsername: legacyViewer.username,
		legacySessionId,
		representativeMembers: representatives.length,
		fanoutEntries: representatives.length,
		privateEntries: representatives.length - 1,
		hostileHistoryCodeUnits: hostileHistory.length,
		hostileCounterCodeUnits: hostileCounter.length,
		realNames: representatives
			.map(representative => representative.name?.trim())
			.filter((name): name is string => Boolean(name)),
	}
}

type ActiveMediaMeasurement = {
	logicalQueries: number
	sqlQueries: number
	entryReads: number
	entrySqlReads: number
	trackingStateLookups: number
	trackingStateLookupSqlReads: number
}

function installMediaLoaderInstrumentation(prisma: PrismaClient) {
	let activeMeasurement: ActiveMediaMeasurement | null = null
	// Logical queries are counted synchronously in the instrumented delegate, but
	// SQL statements arrive on Prisma's asynchronous `query` event. Reading the
	// counters the instant an operation resolves races that stream: a statement
	// still in flight is either dropped, or — because these measurements run one
	// after another — counted against whichever measurement is active when it
	// finally lands. The media-detail SQL ceiling failed and then passed on
	// identical code because of the second case.
	const DRAIN_MARKER = 'veud-media-measurement-drain'
	let drainResolve: (() => void) | null = null
	const queryEvents = prisma as unknown as {
		$on(eventType: 'query', callback: (event: { query: string }) => void): void
	}
	queryEvents.$on('query', event => {
		if (event.query.includes(DRAIN_MARKER)) {
			drainResolve?.()
			return
		}
		if (!activeMeasurement) return
		activeMeasurement.sqlQueries += 1
		if (
			/^\s*(?:SELECT|WITH)\b/i.test(event.query) &&
			/"Entry"/.test(event.query)
		) {
			activeMeasurement.entrySqlReads += 1
		}
		if (
			/^\s*SELECT\b/i.test(event.query) &&
			/"TrackingState"/.test(event.query) &&
			/"startedAt"/.test(event.query) &&
			/"completedAt"/.test(event.query) &&
			/"repeatCount"/.test(event.query)
		) {
			activeMeasurement.trackingStateLookupSqlReads += 1
		}
	})

	type InstrumentedOperation = (...args: never[]) => unknown
	function instrumentOperation(
		target: object,
		delegateName: string,
		operation: string,
	) {
		const delegate = target as Record<string, InstrumentedOperation>
		const original = delegate[operation]
		if (typeof original !== 'function') {
			throw new Error(
				`Cannot instrument Prisma operation ${delegateName}.${operation}`,
			)
		}
		Object.defineProperty(target, operation, {
			configurable: true,
			value: (...operationArgs: never[]) => {
				if (activeMeasurement) {
					activeMeasurement.logicalQueries += 1
					if (delegateName === 'entry') {
						activeMeasurement.entryReads += 1
					}
					if (delegateName === 'trackingState' && operation === 'findUnique') {
						activeMeasurement.trackingStateLookups += 1
					}
				}
				return original.apply(target, operationArgs)
			},
		})
	}
	for (const [delegateName, delegate, operations] of [
		['session', prisma.session, ['findUnique']],
		['user', prisma.user, ['updateMany']],
		['media', prisma.media, ['findUnique', 'findMany']],
		['catalogMediaMerge', prisma.catalogMediaMerge, ['findFirst']],
		[
			'trackingState',
			prisma.trackingState,
			['findUnique', 'findMany', 'aggregate', 'groupBy'],
		],
		['mediaRelation', prisma.mediaRelation, ['findMany']],
		['activityEvent', prisma.activityEvent, ['findMany']],
		['review', prisma.review, ['findUnique', 'findMany']],
		['diaryEntry', prisma.diaryEntry, ['findMany']],
		['mediaCollection', prisma.mediaCollection, ['findMany']],
		['userFavorite', prisma.userFavorite, ['findFirst']],
		['releaseReminder', prisma.releaseReminder, ['findUnique']],
		['watchlist', prisma.watchlist, ['findMany']],
		['prisma', prisma, ['$queryRaw']],
		[
			'entry',
			prisma.entry,
			[
				'findUnique',
				'findUniqueOrThrow',
				'findFirst',
				'findFirstOrThrow',
				'findMany',
				'count',
				'aggregate',
				'groupBy',
			],
		],
	] as const) {
		for (const operation of operations) {
			instrumentOperation(delegate, delegateName, operation)
		}
	}

	/**
	 * Wait until every statement issued so far has been reported. The engine
	 * delivers query events in order, so the arrival of a sentinel issued last
	 * proves the earlier ones already landed. The sentinel goes through
	 * `$queryRawUnsafe`, which is deliberately uninstrumented, and is recognised
	 * by its marker so it never counts as a statement itself.
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
				void (
					prisma as unknown as {
						$queryRawUnsafe(query: string): Promise<unknown>
					}
				)
					.$queryRawUnsafe(`SELECT 1 /* ${DRAIN_MARKER} */`)
					.catch(reject)
			})
		} finally {
			drainResolve = null
		}
	}

	return async function measure<Value>(operation: () => Promise<Value>) {
		if (activeMeasurement) {
			throw new Error('Media loader measurements may not overlap')
		}
		const measurement: ActiveMediaMeasurement = {
			logicalQueries: 0,
			sqlQueries: 0,
			entryReads: 0,
			entrySqlReads: 0,
			trackingStateLookups: 0,
			trackingStateLookupSqlReads: 0,
		}
		activeMeasurement = measurement
		const started = performance.now()
		try {
			const value = await operation()
			// Wall time is taken before the drain, so the sentinel round trip is
			// not charged to the operation being measured.
			const wallMs = Number((performance.now() - started).toFixed(3))
			await drainQueryEvents()
			return { value, ...measurement, wallMs }
		} finally {
			activeMeasurement = null
		}
	}
}

function hasRealNameField(value: unknown) {
	const stack = [value]
	while (stack.length) {
		const current = stack.pop()
		if (!current || typeof current !== 'object') continue
		if (Array.isArray(current)) {
			stack.push(...current)
			continue
		}
		const record = current as Record<string, unknown>
		if (
			typeof record.username === 'string' &&
			Object.prototype.hasOwnProperty.call(record, 'name')
		) {
			return true
		}
		stack.push(...Object.values(record))
	}
	return false
}

function mediaLoaderPayload(
	result: Awaited<ReturnType<typeof mediaDetailLoader>>,
) {
	if (
		!result ||
		typeof result !== 'object' ||
		!('data' in result) ||
		!result.data ||
		typeof result.data !== 'object'
	) {
		throw new Error('Media loader returned an unexpected response shape')
	}
	return result.data
}

async function legacyEntryQueryPlan(
	prisma: PrismaClient,
	fixture: MediaProvenanceFixture,
) {
	const started = performance.now()
	const rows = await prisma.$queryRawUnsafe(
		`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
		 SELECT
		   substr("Entry"."id", 1, CAST($1 AS INTEGER)) AS "id",
		   substr("Entry"."watchlistId", 1, CAST($2 AS INTEGER)) AS "watchlistId",
		   substr(CAST("Entry"."personal" AS TEXT), 1, CAST($3 AS INTEGER)) AS "personal",
		   substr("Entry"."history", 1, CAST($4 AS INTEGER)) AS "history",
		   substr("Entry"."length", 1, CAST($5 AS INTEGER)) AS "length",
		   substr("Entry"."chapters", 1, CAST($6 AS INTEGER)) AS "chapters",
		   substr("Entry"."volumes", 1, CAST($7 AS INTEGER)) AS "volumes",
		   substr("Watchlist"."name", 1, CAST($8 AS INTEGER)) AS "watchlistName"
		 FROM "Entry"
		 INNER JOIN "Watchlist"
		   ON "Watchlist"."id" = "Entry"."watchlistId"
		 WHERE "Entry"."mediaId" = $9
		   AND "Watchlist"."ownerId" = $10
		 ORDER BY "Entry"."id" ASC
		 LIMIT CAST($11 AS INTEGER)`,
		LEGACY_TRACKING_ID_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_ID_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_SCORE_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_HISTORY_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_COUNTER_CODE_UNIT_LIMIT + 1,
		LEGACY_TRACKING_STATUS_CODE_UNIT_LIMIT + 1,
		fixture.mediaId,
		fixture.legacyViewerId,
		LEGACY_TRACKING_ENTRY_LIMIT + 1,
	)
	return {
		name: 'media-legacy-owner-entry',
		wallMs: Number((performance.now() - started).toFixed(3)),
		...summarizeExplain(rows),
	}
}

async function mediaDetailProvenanceRegression(
	prisma: PrismaClient,
	loader: typeof mediaDetailLoader,
	loadFavorites: typeof loadProfileFavorites,
) {
	const measure = installMediaLoaderInstrumentation(prisma)
	try {
		const fixture = await createMediaProvenanceFixture(prisma)
		const { authSessionStorage } = await import('#app/utils/session.server.ts')
		const cookieForSession = async (sessionId: string) => {
			const cookieSession = await authSessionStorage.getSession()
			cookieSession.set('sessionId', sessionId)
			return (await authSessionStorage.commitSession(cookieSession)).split(
				';',
			)[0]!
		}
		const [cookie, legacyCookie] = await Promise.all([
			cookieForSession(fixture.sessionId),
			cookieForSession(fixture.legacySessionId),
		])
		const load = (request: Request) =>
			loader({
				request,
				params: { mediaId: fixture.mediaId },
			} as unknown as Parameters<typeof loader>[0]).then(mediaLoaderPayload)
		const anonymous = await measure(() =>
			load(
				new Request(
					`https://profile-smoke.invalid/media/${encodeURIComponent(fixture.mediaId)}`,
				),
			),
		)
		const normalizedSigned = await measure(() =>
			load(
				new Request(
					`https://profile-smoke.invalid/media/${encodeURIComponent(fixture.mediaId)}`,
					{ headers: { cookie } },
				),
			),
		)
		const boundedLegacy = await measure(() =>
			load(
				new Request(
					`https://profile-smoke.invalid/media/${encodeURIComponent(fixture.mediaId)}`,
					{ headers: { cookie: legacyCookie } },
				),
			),
		)
		const favoriteProjection = await loadFavorites(fixture.legacyViewerUsername)
		const anonymousPayload = JSON.stringify(anonymous.value)
		const signedPayload = JSON.stringify(normalizedSigned.value)
		const legacyPayload = JSON.stringify(boundedLegacy.value)
		const favoritePayload = JSON.stringify(favoriteProjection)
		const combinedPayload = `${anonymousPayload}\n${signedPayload}\n${legacyPayload}\n${favoritePayload}`
		const privateCatalogTextVisible =
			combinedPayload.includes(privateCatalogSentinel) ||
			combinedPayload.includes('https://private.invalid/')
		const linkedFavoritePrivateTextVisible =
			favoritePayload.includes(privateCatalogSentinel) ||
			favoritePayload.includes('https://private.invalid/')
		const realNameValueVisible = fixture.realNames.some(name =>
			combinedPayload.includes(name),
		)
		const realNameFieldVisible =
			hasRealNameField(anonymous.value) ||
			hasRealNameField(normalizedSigned.value) ||
			hasRealNameField(boundedLegacy.value)

		const anonymousData = anonymous.value as {
			media?: {
				title?: unknown
				description?: unknown
				imageUrl?: unknown
			}
			viewer?: unknown
		}
		const signedData = normalizedSigned.value as {
			viewer?: {
				id?: unknown
				tracking?: {
					status?: unknown
					score?: unknown
				}
			} | null
			socialContext?: { items?: unknown[] } | null
			reviews?: Array<{ comments?: unknown[] }>
			activity?: unknown[]
		}
		const legacyData = boundedLegacy.value as {
			viewer?: {
				id?: unknown
				tracking?: unknown
			} | null
		}
		if (
			anonymousData.media?.title !== 'Untitled movie' ||
			anonymousData.media?.description !== undefined ||
			anonymousData.media?.imageUrl !== null ||
			anonymousData.viewer !== null
		) {
			throw new Error(
				'Anonymous sparse media did not remain canonical-only and viewer-free',
			)
		}
		if (
			legacyData.viewer?.id !== fixture.legacyViewerId ||
			legacyData.viewer.tracking !== null
		) {
			throw new Error(
				'Oversized legacy media projection did not fail closed without tracking state',
			)
		}
		if (
			signedData.viewer?.id !== fixture.viewerId ||
			signedData.viewer.tracking?.status !== 'watching' ||
			Number(signedData.viewer.tracking.score) !== 8
		) {
			throw new Error(
				'Normalized signed media loader did not return its owner tracking state',
			)
		}
		if (
			(signedData.socialContext?.items?.length ?? 0) < 1 ||
			(signedData.reviews?.[0]?.comments?.length ?? 0) < 1 ||
			(signedData.activity?.length ?? 0) < 1
		) {
			throw new Error(
				'Media provenance fixture did not exercise followed tracking, review comments, and activity identities',
			)
		}
		const projectedFavorite = favoriteProjection.favorites[0]
		if (
			favoriteProjection.favorites.length !== 1 ||
			favoriteProjection.favoritesLimited ||
			projectedFavorite?.mediaId !== fixture.mediaId ||
			projectedFavorite.title !== 'Untitled movie' ||
			projectedFavorite.thumbnail !== null ||
			projectedFavorite.mediaType !== '' ||
			projectedFavorite.startYear !== ''
		) {
			throw new Error(
				'Linked sparse favorite did not use bounded canonical PostgreSQL metadata',
			)
		}

		const evidence = {
			version: 1,
			fixture: {
				representativeMembers: fixture.representativeMembers,
				fanoutEntries: fixture.fanoutEntries,
				privateEntries: fixture.privateEntries,
				hostileHistoryCodeUnits: fixture.hostileHistoryCodeUnits,
				hostileCounterCodeUnits: fixture.hostileCounterCodeUnits,
			},
			anonymous: {
				logicalQueries: anonymous.logicalQueries,
				sqlQueries: anonymous.sqlQueries,
				entryReads: anonymous.entryReads,
				entrySqlReads: anonymous.entrySqlReads,
				trackingStateLookups: anonymous.trackingStateLookups,
				trackingStateLookupSqlReads: anonymous.trackingStateLookupSqlReads,
				payloadBytes: Buffer.byteLength(anonymousPayload),
				wallMs: anonymous.wallMs,
			},
			normalizedSigned: {
				logicalQueries: normalizedSigned.logicalQueries,
				sqlQueries: normalizedSigned.sqlQueries,
				entryReads: normalizedSigned.entryReads,
				entrySqlReads: normalizedSigned.entrySqlReads,
				trackingStateLookups: normalizedSigned.trackingStateLookups,
				trackingStateLookupSqlReads:
					normalizedSigned.trackingStateLookupSqlReads,
				payloadBytes: Buffer.byteLength(signedPayload),
				wallMs: normalizedSigned.wallMs,
			},
			boundedLegacy: {
				logicalQueries: boundedLegacy.logicalQueries,
				sqlQueries: boundedLegacy.sqlQueries,
				entryReads: boundedLegacy.entryReads,
				entrySqlReads: boundedLegacy.entrySqlReads,
				trackingStateLookups: boundedLegacy.trackingStateLookups,
				trackingStateLookupSqlReads: boundedLegacy.trackingStateLookupSqlReads,
				payloadBytes: Buffer.byteLength(legacyPayload),
				wallMs: boundedLegacy.wallMs,
			},
			privacy: {
				privateCatalogTextVisible,
				linkedFavoritePrivateTextVisible,
				realNameValueVisible,
				realNameFieldVisible,
			},
			legacyEntryPlan: await legacyEntryQueryPlan(prisma, fixture),
		}
		assertMediaDetailLoadEvidence(evidence)
		return evidence
	} finally {
		await cleanupMediaProvenanceFixtures(prisma)
	}
}

type CatalogSyncKey = Readonly<{
	provider: string
	kind: string
	mode: string
}>

const CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX = 'profile-provenance-repair-'
const CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR_KEY = {
	provider: 'veud-smoke',
	kind: 'catalog-provenance',
	mode: 'repair-regression',
} as const
const CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR = JSON.stringify({
	fixture: 'postgres-profile-provenance-repair',
	version: 1,
})
const CATALOG_PROVENANCE_REPAIR_SMOKE_LEASE_MS = 30 * 60 * 1_000

async function claimCatalogProvenanceRepairFixture(
	prisma: PrismaClient,
	repairCursorKey: CatalogSyncKey,
) {
	const leaseOwner = `postgres-profile-provenance-repair:${process.pid}:${randomUUID()}`
	const now = new Date()
	const leaseExpiresAt = new Date(
		now.getTime() + CATALOG_PROVENANCE_REPAIR_SMOKE_LEASE_MS,
	)

	await prisma.$transaction(async tx => {
		const existingSmokeCursor = await tx.catalogSyncCursor.findUnique({
			where: {
				provider_kind_mode: CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR_KEY,
			},
			select: {
				id: true,
				cursor: true,
				leaseOwner: true,
				leaseExpiresAt: true,
			},
		})

		if (existingSmokeCursor) {
			if (
				existingSmokeCursor.cursor !== CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR ||
				!existingSmokeCursor.leaseOwner ||
				!existingSmokeCursor.leaseExpiresAt
			) {
				throw new Error(
					'PostgreSQL provenance smoke ownership marker is not recognized; preserving it for manual review',
				)
			}
			if (existingSmokeCursor.leaseExpiresAt.getTime() > now.getTime()) {
				throw new Error(
					'Another PostgreSQL provenance repair regression still owns the smoke fixture lease',
				)
			}
			const removedExpiredLease = await tx.catalogSyncCursor.deleteMany({
				where: {
					id: existingSmokeCursor.id,
					leaseOwner: existingSmokeCursor.leaseOwner,
					leaseExpiresAt: { lte: now },
				},
			})
			if (removedExpiredLease.count !== 1) {
				throw new Error(
					'PostgreSQL provenance smoke fixture lease changed during recovery',
				)
			}
			await tx.catalogSyncRun.deleteMany({ where: repairCursorKey })
			await tx.catalogSyncCursor.deleteMany({ where: repairCursorKey })
		} else {
			const [existingRepairCursor, existingRepairRuns] = await Promise.all([
				tx.catalogSyncCursor.findUnique({
					where: { provider_kind_mode: repairCursorKey },
					select: { id: true },
				}),
				tx.catalogSyncRun.count({ where: repairCursorKey }),
			])
			if (existingRepairCursor || existingRepairRuns) {
				throw new Error(
					'PostgreSQL provenance repair state already exists without a smoke ownership marker; preserving it',
				)
			}
		}

		await tx.user.deleteMany({
			where: { id: { startsWith: CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX } },
		})
		await tx.media.deleteMany({
			where: { id: { startsWith: CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX } },
		})
		await tx.catalogSyncCursor.create({
			data: {
				...CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR_KEY,
				cursor: CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR,
				leaseOwner,
				leaseExpiresAt,
			},
		})
	})

	return leaseOwner
}

async function cleanupCatalogProvenanceRepairFixture(
	prisma: PrismaClient,
	repairCursorKey: CatalogSyncKey,
	leaseOwner: string,
) {
	await prisma.$transaction(async tx => {
		const smokeCursor = await tx.catalogSyncCursor.findUnique({
			where: {
				provider_kind_mode: CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR_KEY,
			},
			select: { id: true, cursor: true, leaseOwner: true },
		})
		if (
			smokeCursor?.cursor !== CATALOG_PROVENANCE_REPAIR_SMOKE_CURSOR ||
			smokeCursor.leaseOwner !== leaseOwner
		) {
			throw new Error(
				'PostgreSQL provenance smoke fixture ownership was lost; preserving the current owner’s state',
			)
		}

		await tx.user.deleteMany({
			where: { id: { startsWith: CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX } },
		})
		await tx.media.deleteMany({
			where: { id: { startsWith: CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX } },
		})
		await tx.catalogSyncRun.deleteMany({ where: repairCursorKey })
		await tx.catalogSyncCursor.deleteMany({ where: repairCursorKey })

		const [fixtureUsers, fixtureMedia, repairRuns, repairCursor] =
			await Promise.all([
				tx.user.count({
					where: {
						id: { startsWith: CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX },
					},
				}),
				tx.media.count({
					where: {
						id: { startsWith: CATALOG_PROVENANCE_REPAIR_FIXTURE_PREFIX },
					},
				}),
				tx.catalogSyncRun.count({ where: repairCursorKey }),
				tx.catalogSyncCursor.count({ where: repairCursorKey }),
			])
		if (fixtureUsers || fixtureMedia || repairRuns || repairCursor) {
			throw new Error(
				'PostgreSQL provenance smoke fixture cleanup left residual state',
			)
		}

		const releasedLease = await tx.catalogSyncCursor.deleteMany({
			where: { id: smokeCursor.id, leaseOwner },
		})
		if (releasedLease.count !== 1) {
			throw new Error(
				'PostgreSQL provenance smoke fixture lease changed during cleanup',
			)
		}
	})
}

async function catalogProvenanceRepairRegression(prisma: PrismaClient) {
	const {
		assertCatalogProvenanceBoundaryReady,
		CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR,
		CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		CATALOG_PROVENANCE_REPAIR_CURSOR_KEY,
		repairMediaCatalogProvenance,
	} = await import('#app/utils/media-provenance-repair.server.ts')
	const suffix = `${Date.now()}-${process.pid}`
	const ownerId = `profile-provenance-repair-owner-${suffix}`
	const sourceMediaId = `profile-provenance-repair-source-${suffix}`
	const targetMediaId = `profile-provenance-repair-target-${suffix}`
	const privateSentinel = 'PRIVATE POSTGRES CATALOG SNAPSHOT'
	const fixtureLeaseOwner = await claimCatalogProvenanceRepairFixture(
		prisma,
		CATALOG_PROVENANCE_REPAIR_CURSOR_KEY,
	)
	try {
		const listType = await prisma.listType.findUniqueOrThrow({
			where: { name: 'liveaction' },
			select: { id: true },
		})
		const owner = await prisma.user.create({
			data: {
				id: ownerId,
				email: `profile-provenance-repair-${suffix}@synthetic.invalid`,
				username: `profile_provenance_repair_${suffix.replaceAll('-', '_')}`,
			},
		})
		const watchlist = await prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: `provenance-repair-${suffix}`,
				header: 'Provenance repair',
				isPublic: false,
			},
		})
		await Promise.all([
			prisma.media.create({
				data: {
					id: sourceMediaId,
					kind: 'movie',
					title: privateSentinel,
					description: privateSentinel.padEnd(1024 * 1024, 'x'),
					genres: privateSentinel,
					catalogProvenanceVersion: 0,
					externalIds: {
						create: {
							provider: 'tmdb',
							kind: 'movie',
							externalId: `provenance-repair-${suffix}`,
							sourceTitle: 'Trusted PostgreSQL provider title',
							sourcePopularity: 4_321,
						},
					},
				},
			}),
			prisma.media.create({
				data: {
					id: targetMediaId,
					kind: 'movie',
					title: 'Trusted relation target',
					catalogProvenanceVersion: 1,
				},
			}),
		])
		const [entry, favorite] = await Promise.all([
			prisma.entry.create({
				data: {
					watchlistId: watchlist.id,
					mediaId: sourceMediaId,
					position: 1,
					title: privateSentinel,
					description: privateSentinel,
					personal: 9,
					history: '{"episode":4}',
					notes: 'Member note remains',
				},
			}),
			prisma.userFavorite.create({
				data: {
					ownerId: owner.id,
					typeId: listType.id,
					mediaId: sourceMediaId,
					position: 1,
					title: privateSentinel,
					thumbnail: privateSentinel,
				},
			}),
			prisma.mediaRelation.create({
				data: {
					sourceMediaId,
					targetMediaId,
					relationType: 'sequel',
					provider: 'tmdb',
					catalogProvenanceVersion: 0,
				},
			}),
		])

		const dryRun = await repairMediaCatalogProvenance(prisma, {
			batchSize: 1,
		})
		if (
			dryRun.completed ||
			dryRun.before.mediaToQuarantine !== 1 ||
			dryRun.before.untrustedRelations !== 1
		) {
			throw new Error('PostgreSQL provenance dry-run inventory is incorrect')
		}
		const committed = await repairMediaCatalogProvenance(prisma, {
			batchSize: 1,
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		})
		if (
			!committed.completed ||
			committed.processedMedia !== 1 ||
			committed.after.mediaToQuarantine !== 0 ||
			committed.after.untrustedRelations !== 0
		) {
			throw new Error('PostgreSQL provenance repair did not complete cleanly')
		}
		await assertCatalogProvenanceBoundaryReady(prisma)

		const [media, repairedEntry, repairedFavorite, marker] = await Promise.all([
			prisma.media.findUniqueOrThrow({ where: { id: sourceMediaId } }),
			prisma.entry.findUniqueOrThrow({ where: { id: entry.id } }),
			prisma.userFavorite.findUniqueOrThrow({ where: { id: favorite.id } }),
			prisma.catalogSyncCursor.findUniqueOrThrow({
				where: { provider_kind_mode: CATALOG_PROVENANCE_REPAIR_CURSOR_KEY },
				select: { cursor: true, lastSuccessfulAt: true },
			}),
		])
		if (
			media.catalogProvenanceVersion !== 1 ||
			media.title !== 'Trusted PostgreSQL provider title' ||
			media.description !== null ||
			media.genres !== null ||
			Number(media.catalogPopularity) !== 4_321 ||
			repairedEntry.title !== 'Trusted PostgreSQL provider title' ||
			repairedEntry.description !== null ||
			Number(repairedEntry.personal) !== 9 ||
			repairedEntry.history !== '{"episode":4}' ||
			repairedEntry.notes !== 'Member note remains' ||
			repairedFavorite.title !== 'Trusted PostgreSQL provider title' ||
			repairedFavorite.thumbnail !== null ||
			marker.cursor !== CATALOG_PROVENANCE_REPAIR_COMPLETE_CURSOR ||
			!marker.lastSuccessfulAt
		) {
			throw new Error(
				'PostgreSQL provenance repair changed user data or retained catalog poison',
			)
		}

		const preview = await prisma.trackingCommandPreview.create({
			data: {
				ownerId: owner.id,
				requestText: 'track a current title',
				operations: JSON.stringify({ mediaId: sourceMediaId }),
				snapshotHash: `post-repair-${suffix}`,
				expiresAt: new Date(Date.now() + 60_000),
			},
		})
		const repeated = await repairMediaCatalogProvenance(prisma, {
			batchSize: 1,
			commit: true,
			confirmation: CATALOG_PROVENANCE_REPAIR_CONFIRMATION,
		})
		if (
			!repeated.alreadyCompleted ||
			repeated.processedMedia !== 0 ||
			!(await prisma.trackingCommandPreview.findUnique({
				where: { id: preview.id },
			}))
		) {
			throw new Error(
				'PostgreSQL provenance repeat run changed post-cutover state',
			)
		}
		return {
			dryRunMedia: dryRun.before.mediaToQuarantine,
			processedMedia: committed.processedMedia,
			repeatNoOp: true,
		}
	} finally {
		await cleanupCatalogProvenanceRepairFixture(
			prisma,
			CATALOG_PROVENANCE_REPAIR_CURSOR_KEY,
			fixtureLeaseOwner,
		)
	}
}

async function main() {
	assertKnownArguments()
	assertSafeLoadDatabaseUrl(process.env.DATABASE_URL)
	process.env.SESSION_SECRET ??= 'postgres-profile-smoke-only'

	const username = valueFor('--username')
	const expectedEntries = positiveInteger('--expected-entries')
	const expectedActivity = positiveInteger('--expected-activity')
	const unsafeActivityId = valueFor('--unsafe-activity-id')
	const reportPath = path.resolve(valueFor('--report'))
	const [
		{ prisma },
		profileData,
		imports,
		activityWriter,
		visibility,
		mediaRoute,
		cellWriter,
		trackingStatus,
		libraryMutex,
	] = await Promise.all([
		import('#app/utils/db.server.ts'),
		import('#app/utils/profile-data.server.ts'),
		import('#app/utils/library-import-commit.server.ts'),
		import('#app/utils/activity.server.ts'),
		import('#app/utils/lists/activity-visibility.server.ts'),
		import('#app/routes/media+/$mediaId.tsx'),
		import('#app/routes/lists+/.fetch+/update-cell.$request.ts'),
		import('#app/utils/tracking-status.server.ts'),
		import('#app/utils/watchlist-limits.ts'),
	])

	try {
		const request = new Request(
			`https://profile-smoke.invalid/users/${encodeURIComponent(username)}`,
		)
		const overview = await measured(() =>
			profileData.loadProfileOverview(request, username),
		)
		const stats = await measured(() =>
			profileData.loadProfileStats(request, username),
		)
		const activity = await measured(() =>
			profileData.loadProfileActivity(request, username),
		)

		if (overview.value.diagnostic.processed !== expectedEntries) {
			throw new Error(
				`Overview processed ${overview.value.diagnostic.processed} entries; expected ${expectedEntries}`,
			)
		}
		if (stats.value.diagnostic.processed !== expectedEntries) {
			throw new Error(
				`Stats processed ${stats.value.diagnostic.processed} entries; expected ${expectedEntries}`,
			)
		}
		if (
			overview.value.diagnostic.truncated ||
			stats.value.diagnostic.truncated
		) {
			throw new Error(
				'Profile analytics unexpectedly truncated the representative fixture',
			)
		}
		const countedStatsEntries = Object.values(
			stats.value.listTypeCounts,
		).reduce((sum, count) => sum + count, 0)
		if (countedStatsEntries !== expectedEntries) {
			throw new Error(
				`Stats counted ${countedStatsEntries} entries; expected ${expectedEntries}`,
			)
		}
		if (activity.value.activityEvents.length !== expectedActivity) {
			throw new Error(
				`Activity returned ${activity.value.activityEvents.length} rows; expected ${expectedActivity}`,
			)
		}
		if (
			activity.value.activityEvents.some(
				event => event.id === `tracking:${unsafeActivityId}`,
			)
		) {
			throw new Error(
				'Public activity exposed an event without immutable list provenance',
			)
		}
		if (!activity.value.activityLimited) {
			throw new Error('Activity did not report its bounded source truncation')
		}
		const mediaDetail = await mediaDetailProvenanceRegression(
			prisma,
			mediaRoute.loader,
			profileData.loadProfileFavorites,
		)

		const report = {
			version: 1,
			measuredAt: new Date().toISOString(),
			expectedEntries,
			expectedActivity,
			overview: {
				wallMs: overview.wallMs,
				bytes: compactJson(overview.value, 'Overview', 128 * 1024),
				processed: overview.value.diagnostic.processed,
				truncated: overview.value.diagnostic.truncated,
			},
			stats: {
				wallMs: stats.wallMs,
				bytes: compactJson(stats.value, 'Stats', 256 * 1024),
				processed: stats.value.diagnostic.processed,
				truncated: stats.value.diagnostic.truncated,
				countedEntries: countedStatsEntries,
			},
			activity: {
				wallMs: activity.wallMs,
				bytes: compactJson(activity.value, 'Activity', 64 * 1024),
				returned: activity.value.activityEvents.length,
				limited: activity.value.activityLimited,
				unsafeProvenanceEventVisible: false,
			},
			mediaDetail,
			importConcurrency: await importConcurrencyRegression(
				prisma,
				imports.applyLibraryImportBatch,
			),
			scoreStatusMutexOrder: await scoreStatusMutexOrderRegression(
				prisma,
				mediaRoute.action,
				trackingStatus,
				libraryMutex,
			),
			cellHistoryMutex: await cellHistoryMutexRegression(
				prisma,
				cellWriter,
				libraryMutex,
			),
			activityMultiOperationConcurrency:
				await activityMultiOperationConcurrencyRegression(
					prisma,
					activityWriter,
				),
			activityVisibilityConcurrency:
				await activityVisibilityConcurrencyRegression(
					prisma,
					activityWriter,
					visibility,
				),
			activityDeletionConcurrency: await activityDeletionConcurrencyRegression(
				prisma,
				activityWriter,
				visibility,
			),
			catalogProvenanceRepair: await catalogProvenanceRepairRegression(prisma),
		}
		writePrivateJson(reportPath, report)
		console.log(
			`Profile loader smoke passed: ${expectedEntries} entries, ${expectedActivity} activity rows, ${report.activity.bytes}B activity payload; media detail ${mediaDetail.anonymous.logicalQueries}/${mediaDetail.normalizedSigned.logicalQueries}/${mediaDetail.boundedLegacy.logicalQueries} anonymous/normalized/legacy logical queries with Entry SQL reads 0/0/1.`,
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
