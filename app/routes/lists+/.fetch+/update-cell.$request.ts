import { type Prisma } from '@prisma/client'
import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { syncTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

async function updateEntryAndTrackingState(
	tx: Prisma.TransactionClient,
	ownerId: string,
	entryId: string,
	data: Record<string, unknown>,
) {
	await serializeUserLibraryMutation(tx, ownerId)
	await tx.entry.update({
		where: { id: entryId },
		data: data as any,
	})
	await syncTrackingStateForEntry(tx, entryId)
	return tx.entry.findUniqueOrThrow({ where: { id: entryId } })
}

function castType(varIn: unknown, varType: string): unknown {
	const typeFormatted = varType.toLowerCase()

	if (typeFormatted.includes('bool')) {
		if (varIn === 'true') return true
		if (varIn === 'false') return false
		throw new Response('Invalid boolean value', { status: 400 })
	} else if (
		typeFormatted.includes('num') ||
		typeFormatted.includes('int') ||
		typeFormatted.includes('decimal')
	) {
		const value = Number(varIn)
		if (!Number.isFinite(value)) {
			throw new Response('Invalid numeric value', { status: 400 })
		}
		return value
	} else if (typeFormatted.includes('string') || typeFormatted.includes('text'))
		return String(varIn)
	else if (typeFormatted.includes('date') || typeFormatted.includes('time')) {
		if (
			typeof varIn !== 'string' &&
			typeof varIn !== 'number' &&
			!(varIn instanceof Date)
		) {
			throw new Response('Invalid date value', { status: 400 })
		}
		const value = new Date(varIn)
		if (Number.isNaN(value.getTime())) {
			throw new Response('Invalid date value', { status: 400 })
		}
		return value.toISOString()
	} else if (typeFormatted.includes('undefined')) return undefined
	else return varIn
}

export async function updateEntryCellCommand(
	ownerId: string,
	input: {
		entryId: string | null
		columnId: string | null
		value: unknown
	},
) {
	try {
		return await prisma.$transaction(async tx => {
			await serializeUserLibraryMutation(tx, ownerId)
			const entry = input.entryId
				? await tx.entry.findUnique({
						where: { id: input.entryId },
						include: {
							watchlist: {
								include: {
									type: { select: { columns: true, mediaType: true } },
								},
							},
						},
					})
				: null
			if (!entry || entry.watchlist.ownerId !== ownerId) {
				throw new Response('Not found', { status: 404 })
			}

			let columnTypes: Record<string, unknown>
			try {
				const parsed = JSON.parse(entry.watchlist.type.columns) as unknown
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					throw new Error('Invalid columns')
				}
				columnTypes = parsed as Record<string, unknown>
			} catch {
				throw new Response('Invalid list type columns', { status: 500 })
			}

			const colId = input.columnId
			const historyAliases: Record<string, string> = {
				started: 'startDate',
				finished: 'finishedDate',
				added: 'dateAdded',
				lastUpdated: 'lastUpdated',
			}
			const protectedColumns = new Set([
				'id',
				'watchlistId',
				'watchlist',
				'position',
				'mediaId',
				'media',
				'trackingStateId',
				'trackingState',
			])
			const schemaColumn = historyAliases[colId ?? ''] ?? colId
			const expectedType = schemaColumn ? columnTypes[schemaColumn] : undefined
			if (
				!colId ||
				protectedColumns.has(colId) ||
				typeof expectedType !== 'string'
			) {
				throw new Response('Invalid editable column', { status: 400 })
			}

			let history: Record<string, any>
			try {
				const parsed = JSON.parse(entry.history ?? '') as unknown
				if (
					!parsed ||
					typeof parsed !== 'object' ||
					Array.isArray(parsed) ||
					Object.keys(parsed).length === 0
				) {
					throw new Error('Invalid history')
				}
				history = parsed as Record<string, any>
			} catch {
				history = {
					added: Date.now(),
					started: null,
					finished: null,
					progress: null,
				}
			}

			if (['length', 'chapters', 'volumes'].includes(colId)) {
				const textValue = String(input.value ?? '')
				if (/\d+\s*\/\s*\d+ eps/.test(textValue) || colId !== 'length') {
					const matchResult = textValue.match(/\d+/)?.[0]
					if (matchResult) {
						if (
							!history.progress ||
							typeof history.progress !== 'object' ||
							Array.isArray(history.progress)
						) {
							history.progress = {}
						}
						if (colId === 'length') {
							if (
								!history.progress[matchResult] ||
								typeof history.progress[matchResult] !== 'object' ||
								Array.isArray(history.progress[matchResult])
							) {
								history.progress[matchResult] = {
									completed: false,
									finishDate: [],
								}
							}
							history.progress[matchResult].finishDate = Array.isArray(
								history.progress[matchResult].finishDate,
							)
								? history.progress[matchResult].finishDate
								: []
							history.progress[matchResult].completed = true
							history.progress[matchResult].finishDate.push(Date.now())
						} else {
							const mediaTypes = JSON.parse(
								entry.watchlist.type.mediaType,
							) as string[]
							const typeIndex = mediaTypes
								.map(mediaType => `${mediaType}s`)
								.findIndex(mediaType => mediaType === colId)
							const mediaType =
								typeIndex >= 0 ? mediaTypes[typeIndex] : mediaTypes[0]
							if (mediaType) {
								if (
									!history.progress[mediaType] ||
									typeof history.progress[mediaType] !== 'object' ||
									Array.isArray(history.progress[mediaType])
								) {
									history.progress[mediaType] = {}
								}
								if (
									!history.progress[mediaType][matchResult] ||
									typeof history.progress[mediaType][matchResult] !==
										'object' ||
									Array.isArray(history.progress[mediaType][matchResult])
								) {
									history.progress[mediaType][matchResult] = {
										completed: false,
										finishDate: [],
									}
								}
								history.progress[mediaType][matchResult].finishDate =
									Array.isArray(
										history.progress[mediaType][matchResult].finishDate,
									)
										? history.progress[mediaType][matchResult].finishDate
										: []
								history.progress[mediaType][matchResult].completed = true
								history.progress[mediaType][matchResult].finishDate.push(
									Date.now(),
								)
							}
						}
					}
				}
				history.lastUpdated = Date.now()
				return updateEntryAndTrackingState(tx, ownerId, entry.id, {
					history: JSON.stringify(history),
				})
			}

			if (expectedType.toLowerCase().includes('history')) {
				if (
					input.value &&
					input.value !== 'null' &&
					typeof input.value !== 'string' &&
					typeof input.value !== 'number'
				) {
					throw new Response('Invalid history date', { status: 400 })
				}
				if (input.value && input.value !== 'null') {
					const date = new Date(input.value as string | number)
					if (Number.isNaN(date.getTime())) {
						throw new Response('Invalid history date', { status: 400 })
					}
					history[colId] = date.toISOString()
				} else {
					history[colId] = null
				}
				if (colId !== 'lastUpdated') history.lastUpdated = Date.now()
				return updateEntryAndTrackingState(tx, ownerId, entry.id, {
					history: JSON.stringify(history),
				})
			}

			history.lastUpdated = Date.now()
			return updateEntryAndTrackingState(tx, ownerId, entry.id, {
				[colId]: castType(input.value, expectedType),
				history: JSON.stringify(history),
			})
		})
	} catch (e) {
		// Auth/ownership failures are already Responses (401/404) — let them through.
		if (e instanceof Response) throw e
		// Anything else is an unexpected server error: log it server-side and return a
		// generic 500 (never the raw error object, and never HTTP 200-on-failure).
		console.error('[update-cell] failed to update cell:', e)
		throw new Response('Failed to update cell', { status: 500 })
	}
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return updateEntryCellCommand(ownerId, {
		entryId: searchParams.get('rowIndex'),
		columnId: searchParams.get('colId'),
		value: searchParams.get('newValue'),
	})
}
