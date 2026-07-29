#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { type PrismaClient } from '@prisma/client'
import { type updateEntryCellCommand } from '#app/routes/lists+/.fetch+/update-cell.$request.ts'
import { type action as mediaDetailAction } from '#app/routes/media+/$mediaId.tsx'
import {
	type getTrackingActivityState,
	type recordTrackingActivityDiff,
} from '#app/utils/activity.server.ts'
import { type applyLibraryImportBatch } from '#app/utils/library-import-commit.server.ts'
import { type syncWatchlistActivityVisibility } from '#app/utils/lists/activity-visibility.server.ts'
import { type setMediaTrackingStatus } from '#app/utils/tracking-status.server.ts'
import { type serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'
import { assertSafeLoadDatabaseUrl } from './postgres-load-utils.mjs'

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
			data: { id: mediaId, kind: 'movie', title: 'Mutex order fixture' },
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
			data: { id: mediaId, kind: 'movie', title: 'Visibility race fixture' },
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
			data: { id: mediaId, kind: 'movie', title: 'Deletion race fixture' },
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
		}
		writePrivateJson(reportPath, report)
		console.log(
			`Profile loader smoke passed: ${expectedEntries} entries, ${expectedActivity} activity rows, ${report.activity.bytes}B activity payload.`,
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
