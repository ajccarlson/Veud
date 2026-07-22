import { type Prisma } from '@prisma/client'
import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireEntryOwner } from '#app/utils/lists/authorization.server.ts'
import { syncTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'

async function updateEntryAndTrackingState(
	tx: Prisma.TransactionClient,
	entryId: string,
	data: Record<string, unknown>,
) {
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
		const value = new Date(varIn as string | number | Date)
		if (Number.isNaN(value.getTime())) {
			throw new Response('Invalid date value', { status: 400 })
		}
		return value.toISOString()
	} else if (typeFormatted.includes('undefined')) return undefined
	else return varIn
}

export async function action({ request, params }: ActionFunctionArgs) {
	try {
		const searchParams = new URLSearchParams(params.request)

		// Captured once up front. Each is `string | null`; the null handling below is
		// explicit and matches the original (repeated `searchParams.get()` calls returned
		// the same value anyway). The `as string` casts are runtime no-ops that preserve
		// behavior exactly — including the errors the inner try/catches deliberately swallow.
		const rowIndex = searchParams.get('rowIndex')
		const colId = searchParams.get('colId')
		const newValue = searchParams.get('newValue')

		const { entry, watchlist } = await requireEntryOwner(request, rowIndex)
		const listType = await prisma.listType.findUnique({
			where: { id: watchlist.typeId },
			select: { columns: true, mediaType: true },
		})
		if (!listType) throw new Response('List type not found', { status: 400 })

		let columnTypes: Record<string, unknown>
		try {
			const parsed = JSON.parse(listType.columns) as unknown
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('Invalid columns')
			}
			columnTypes = parsed as Record<string, unknown>
		} catch {
			throw new Response('Invalid list type columns', { status: 500 })
		}

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

		const historyObject: any = entry

		// The stored `history` is free-form JSON manipulated dynamically below, so it's `any`.
		let parsedHistoryObject: any = {}
		try {
			parsedHistoryObject = JSON.parse(historyObject.history)

			if (Object.keys(parsedHistoryObject).length < 1) throw new Error()

			parsedHistoryObject.lastUpdated = Date.now()

			if (['length', 'chapters', 'volumes'].includes(colId as string)) {
				const lengthRegex = /\d+\s*\/\s*\d+ eps/g

				if (lengthRegex.test(newValue as string) || colId != 'length') {
					const mediaTotal = [...(newValue as string).matchAll(/\d+/g)]
					let matchResult: string | undefined

					try {
						matchResult = mediaTotal[0][0]
					} catch (e) {}

					if (matchResult) {
						if (!parsedHistoryObject.progress) {
							parsedHistoryObject.progress = {}
						}

						if (colId == 'length') {
							if (!parsedHistoryObject.progress[matchResult]) {
								parsedHistoryObject.progress[matchResult] = {
									completed: false,
									finishDate: [],
								}
							}

							parsedHistoryObject.progress[matchResult].completed = true
							parsedHistoryObject.progress[matchResult].finishDate.push(
								Date.now(),
							)
						} else {
							let mediaType: string
							const mediaTypeArray = JSON.parse(listType.mediaType) as string[]
							const mediaTypesFormatted = mediaTypeArray.map(
								mediaTypeRaw => `${mediaTypeRaw}s`,
							)
							const typeIndex = mediaTypesFormatted.findIndex(e => e === colId)

							if (!mediaTypesFormatted || mediaTypesFormatted.length < 1) {
								mediaType = 'episode'
							} else if (typeIndex > 0) {
								mediaType = mediaTypeArray[typeIndex]
							} else {
								mediaType = mediaTypeArray[0]
							}

							if (!parsedHistoryObject.progress[mediaType]) {
								parsedHistoryObject.progress[mediaType] = {
									[matchResult]: {
										completed: false,
										finishDate: [],
									},
								}
							}

							if (!parsedHistoryObject.progress[mediaType][matchResult]) {
								parsedHistoryObject.progress[mediaType][matchResult] = {
									completed: false,
									finishDate: [],
								}
							}

							parsedHistoryObject.progress[mediaType][matchResult].completed =
								true
							parsedHistoryObject.progress[mediaType][
								matchResult
							].finishDate.push(Date.now())
						}
					}
				}

				return await prisma.$transaction(tx =>
					updateEntryAndTrackingState(tx, rowIndex as string, {
						history: JSON.stringify(parsedHistoryObject),
					}),
				)
			}
		} catch (e) {
			if (
				!parsedHistoryObject ||
				typeof parsedHistoryObject !== 'object' ||
				Array.isArray(parsedHistoryObject) ||
				Object.keys(parsedHistoryObject).length === 0
			) {
				parsedHistoryObject = {
					added: Date.now(),
					started: null,
					finished: null,
					progress: null,
					lastUpdated: Date.now(),
				}
			}
		}

		let valueFormatted: unknown
		const columnName = colId

		if (expectedType.toLowerCase().includes('history')) {
			if (colId == 'length') {
				parsedHistoryObject['progress'] = JSON.parse(newValue as string)
			} else {
				parsedHistoryObject[colId as string] =
					newValue && newValue != 'null'
						? new Date(newValue).toISOString()
						: null
			}

			return await prisma.$transaction(tx =>
				updateEntryAndTrackingState(tx, rowIndex as string, {
					history: JSON.stringify(parsedHistoryObject),
				}),
			)
		} else {
			valueFormatted = castType(newValue, expectedType)

			return await prisma.$transaction(tx =>
				updateEntryAndTrackingState(tx, rowIndex as string, {
					[columnName as string]: valueFormatted,
					history: JSON.stringify(parsedHistoryObject),
				}),
			)
		}
	} catch (e) {
		// Auth/ownership failures are already Responses (401/404) — let them through.
		if (e instanceof Response) throw e
		// Anything else is an unexpected server error: log it server-side and return a
		// generic 500 (never the raw error object, and never HTTP 200-on-failure).
		console.error('[update-cell] failed to update cell:', e)
		throw new Response('Failed to update cell', { status: 500 })
	}
}
