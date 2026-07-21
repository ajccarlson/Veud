import { type Prisma } from '@prisma/client'
import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireEntryOwner } from '#app/utils/lists/authorization.server.ts'
import {
	EntryOrderError,
	moveEntryToWatchlist,
} from '#app/utils/lists/entry-order.server.ts'
import {
	legacyProgressUpdate,
	progressUnitsForMediaKind,
	totalFromLegacyCounter,
} from '#app/utils/media-detail.ts'
import { syncTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import { trackingStateFromEntry } from '#app/utils/tracking-state.ts'

const categoryScoreFields = [
	'story',
	'character',
	'presentation',
	'sound',
	'performance',
	'enjoyment',
] as const

const editableFields = new Set<string>([
	...categoryScoreFields,
	'personal',
	'priority',
	'notes',
	'started',
	'finished',
	'destinationWatchlistId',
	'repeatCount',
	'progress',
])

function parseScore(value: unknown, integer: boolean) {
	if (value === null || value === undefined || value === '') return null
	const score = Number(value)
	if (!Number.isFinite(score) || score < 1 || score > 10) {
		throw new Response('Scores must be between 1 and 10', { status: 400 })
	}
	if (integer && !Number.isInteger(score)) {
		throw new Response('Category scores must be whole numbers', { status: 400 })
	}
	return score
}

function parseDate(value: unknown) {
	if (value === null || value === undefined || value === '') return null
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Response('Invalid date', { status: 400 })
	}
	const date = new Date(`${value}T00:00:00.000Z`)
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		throw new Response('Invalid date', { status: 400 })
	}
	return date.toISOString()
}

function parseHistory(value: string | null) {
	try {
		const history = JSON.parse(value ?? '')
		if (history && typeof history === 'object' && !Array.isArray(history)) {
			return history as Record<string, unknown>
		}
	} catch {}
	return {
		added: Date.now(),
		started: null,
		finished: null,
		progress: null,
	}
}

function parseWholeNumber(value: unknown, label: string) {
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
		throw new Response(`${label} must be a whole number from 0 to 1,000,000`, {
			status: 400,
		})
	}
	return parsed
}

function parseProgress(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Response('Invalid progress', { status: 400 })
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([unit, current]) => [
			unit,
			parseWholeNumber(current, 'Progress'),
		]),
	)
}

function mediaKindForEntry(entry: {
	media: { kind: string } | null
	watchlist: { type: { name: string } }
	length: string | null
}) {
	if (entry.media?.kind) return entry.media.kind
	if (entry.watchlist.type.name === 'anime') return 'anime'
	if (entry.watchlist.type.name === 'manga') return 'manga'
	return /eps?\b/i.test(entry.length ?? '') ? 'tv' : 'movie'
}

function progressTotal(entry: {
	length?: unknown
	chapters?: unknown
	volumes?: unknown
}, unit: string) {
	if (unit === 'episode') return totalFromLegacyCounter(entry.length)
	if (unit === 'chapter') return totalFromLegacyCounter(entry.chapters)
	if (unit === 'volume') return totalFromLegacyCounter(entry.volumes)
	return null
}

export async function action({ request }: ActionFunctionArgs) {
	let entryId: unknown
	let fields: Record<string, unknown>
	try {
		const payload: unknown = await request.json()
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			throw new Error('Invalid payload')
		}
		entryId = (payload as Record<string, unknown>).entryId
		const parsed = (payload as Record<string, unknown>).fields
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('Invalid fields')
		}
		fields = parsed as Record<string, unknown>
	} catch {
		throw new Response('Invalid advanced edit payload', { status: 400 })
	}
	if (typeof entryId !== 'string') {
		throw new Response('Invalid advanced edit payload', { status: 400 })
	}
	const { userId, entry, watchlist } = await requireEntryOwner(request, entryId)
	const unknownField = Object.keys(fields).find(field => !editableFields.has(field))
	if (unknownField) {
		throw new Response(`Field ${unknownField} cannot be edited`, { status: 400 })
	}

	const data: Record<string, unknown> = {}
	for (const field of categoryScoreFields) {
		if (Object.hasOwn(fields, field)) {
			data[field] = parseScore(fields[field], true)
		}
	}
	if (Object.hasOwn(fields, 'personal')) {
		data.personal = parseScore(fields.personal, false)
	}
	if (Object.hasOwn(fields, 'priority')) {
		if (
			typeof fields.priority !== 'string' ||
			!['', 'Low', 'Medium', 'High'].includes(fields.priority)
		) {
			throw new Response('Invalid priority', { status: 400 })
		}
		data.priority = fields.priority.trim() || null
	}
	if (Object.hasOwn(fields, 'notes')) {
		if (typeof fields.notes !== 'string' || fields.notes.length > 5000) {
			throw new Response('Notes must be 5,000 characters or fewer', {
				status: 400,
			})
		}
		data.notes = fields.notes
	}
	const repeatCount = Object.hasOwn(fields, 'repeatCount')
		? parseWholeNumber(fields.repeatCount, 'Repeat count')
		: null
	const progress = Object.hasOwn(fields, 'progress')
		? parseProgress(fields.progress)
		: null
	const destinationWatchlistId = Object.hasOwn(
		fields,
		'destinationWatchlistId',
	)
		? fields.destinationWatchlistId
		: null
	if (
		destinationWatchlistId !== null &&
		(typeof destinationWatchlistId !== 'string' || !destinationWatchlistId)
	) {
		throw new Response('Invalid status', { status: 400 })
	}

	if (
		Object.hasOwn(fields, 'started') ||
		Object.hasOwn(fields, 'finished') ||
		repeatCount !== null
	) {
		const history = parseHistory(entry.history)
		if (Object.hasOwn(fields, 'started')) {
			history.started = parseDate(fields.started)
		}
		if (Object.hasOwn(fields, 'finished')) {
			history.finished = parseDate(fields.finished)
		}
		if (repeatCount !== null) history.repeatCount = repeatCount
		history.lastUpdated = Date.now()
		data.history = JSON.stringify(history)
	}

	if (
		!Object.keys(data).length &&
		progress === null &&
		destinationWatchlistId === null
	) {
		throw new Response('No editable fields were provided', { status: 400 })
	}

	try {
		return await prisma.$transaction(async tx => {
			const current = await tx.entry.findUnique({
				where: { id: entry.id },
				include: {
					media: { select: { kind: true } },
					watchlist: {
						select: {
							id: true,
							name: true,
							ownerId: true,
							type: { select: { name: true } },
						},
					},
					trackingState: {
						include: { progress: true },
					},
				},
			})
			if (!current || current.watchlist.ownerId !== userId) {
				throw new Response('Not found', { status: 404 })
			}

			const mediaKind = mediaKindForEntry(current)
			const allowedProgress = new Set(progressUnitsForMediaKind(mediaKind))
			let pendingEntry = { ...current, ...data }
			if (progress) {
				for (const [unit, currentProgress] of Object.entries(progress)) {
					if (!allowedProgress.has(unit as any)) {
						throw new Response('Progress unit does not match this media', {
							status: 400,
						})
					}
					const snapshot = trackingStateFromEntry(pendingEntry, {
						status: current.watchlist.name,
						statusWatchlistId: current.watchlist.id,
						mediaKind,
					})
					const saved = current.trackingState?.progress.find(
						item => item.unit === unit,
					)
					const legacy = snapshot.progress.find(item => item.unit === unit)
					const total =
						saved?.total ?? legacy?.total ?? progressTotal(pendingEntry, unit)
					if (total !== null && currentProgress > total) {
						throw new Response('Progress cannot exceed the known total', {
							status: 400,
						})
					}
					const progressUpdate = legacyProgressUpdate(pendingEntry, {
						unit: unit as 'episode' | 'chapter' | 'volume',
						current: currentProgress,
						previousCurrent: saved?.current ?? legacy?.current ?? 0,
						total,
					})
					Object.assign(data, progressUpdate)
					pendingEntry = { ...pendingEntry, ...progressUpdate }
				}
			}

			await tx.entry.update({
				where: { id: current.id },
				data: data as Prisma.EntryUpdateInput,
			})

			if (
				typeof destinationWatchlistId === 'string' &&
				destinationWatchlistId !== current.watchlistId
			) {
				return moveEntryToWatchlist(tx, {
					ownerId: userId,
					entryId: current.id,
					destinationWatchlistId,
					position: null,
				})
			}

			await tx.watchlist.update({
				where: { id: watchlist.id },
				data: { updatedAt: new Date() },
			})
			await syncTrackingStateForEntry(tx, current.id)
			return tx.entry.findUniqueOrThrow({ where: { id: current.id } })
		})
	} catch (error) {
		if (error instanceof EntryOrderError) {
			throw new Response(error.message, { status: error.status })
		}
		throw error
	}
}
