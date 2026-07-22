import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'
import {
	getSortableWatchlistColumns,
	normalizeWatchlistSortColumn,
	normalizeWatchlistSortDirection,
} from '#app/utils/lists/default-sort.ts'
import { syncWatchlistActivityVisibility } from '#app/utils/lists/visibility.server.ts'

// Only these watchlist fields may be changed via the settings form. Everything else
// (id, position, typeId, ownerId, timestamps, relations) is off-limits, so a client can't
// reassign ownership or move a list between types by injecting extra keys.
const EDITABLE_SETTINGS = [
	'name',
	'header',
	'displayedColumns',
	'description',
	'isPublic',
	'defaultSortColumn',
	'defaultSortDirection',
]

// `settings` arrives as a JSON array of [key, value] pairs.
const SettingsSchema = z.array(z.tuple([z.string(), z.unknown()]))

export async function action({ request, params }: ActionFunctionArgs) {
	const searchParams = new URLSearchParams(params.request)

	const listId = searchParams.get('listId')

	// Only the owner may change this watchlist's settings.
	const { userId, watchlist } = await requireWatchlistOwner(request, listId)

	let rawSettings: unknown
	try {
		rawSettings = JSON.parse(searchParams.get('settings') ?? '')
	} catch {
		throw new Response('Invalid settings payload', { status: 400 })
	}
	const parsedSettings = SettingsSchema.safeParse(rawSettings)
	if (!parsedSettings.success) {
		throw new Response('Invalid settings payload', { status: 400 })
	}

	let typeId: unknown
	try {
		typeId = (
			JSON.parse(searchParams.get('listTypeData') ?? '') as { id?: unknown }
		)?.id
	} catch {
		throw new Response('Invalid listTypeData', { status: 400 })
	}
	if (typeof typeId !== 'string') {
		throw new Response('Invalid listTypeData', { status: 400 })
	}
	if (typeId !== watchlist.typeId) {
		throw new Response('Invalid list type', { status: 400 })
	}

	const listType = await prisma.listType.findUnique({
		where: { id: watchlist.typeId },
		select: { columns: true },
	})
	if (!listType) throw new Response('Invalid list type', { status: 400 })
	const sortableColumns = getSortableWatchlistColumns(listType.columns)

	// Whitelist: keep only editable fields, dropping any others (mass-assignment guard).
	const data: Record<string, unknown> = {}
	for (const [key, value] of parsedSettings.data) {
		if (EDITABLE_SETTINGS.includes(key)) {
			if (key === 'isPublic' && typeof value !== 'boolean') {
				throw new Response('Invalid visibility setting', { status: 400 })
			}
			if (key === 'defaultSortColumn') {
				const column = normalizeWatchlistSortColumn(value, sortableColumns)
				if (column === undefined) {
					throw new Response('Invalid default sort column', { status: 400 })
				}
				data[key] = column
				continue
			}
			if (key === 'defaultSortDirection') {
				const direction = normalizeWatchlistSortDirection(value)
				if (!direction) {
					throw new Response('Invalid default sort direction', { status: 400 })
				}
				data[key] = direction
				continue
			}
			data[key] = value
		}
	}

	// Apply the (whitelisted) settings and renumber the owner's watchlists of this type
	// atomically, so a failure can't leave settings half-applied or the ordering off.
	const updated = await prisma.$transaction(async tx => {
		const result =
			Object.keys(data).length > 0
				? await tx.watchlist.update({
						where: { id: watchlist.id },
						data: data as any,
					})
				: watchlist

		await syncWatchlistActivityVisibility(tx, result)

		const remaining = await tx.watchlist.findMany({
			where: { typeId, ownerId: userId },
			orderBy: { position: 'asc' },
		})

		for (let i = 0; i < remaining.length; i++) {
			await tx.watchlist.update({
				where: { id: remaining[i].id },
				data: { position: i + 1 },
			})
		}

		return result
	})

	// The client reads the updated watchlist as the last element of the returned array.
	return [updated]
}
