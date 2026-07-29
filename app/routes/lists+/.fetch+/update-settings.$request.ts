import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { syncWatchlistActivityVisibility } from '#app/utils/lists/activity-visibility.server.ts'
import { requireOwnedWatchlist } from '#app/utils/lists/authorization.server.ts'
import {
	getSortableWatchlistColumns,
	normalizeWatchlistSortColumn,
	normalizeWatchlistSortDirection,
} from '#app/utils/lists/default-sort.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

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

function validatedSetting(key: string, value: unknown) {
	if (key === 'name' || key === 'header') {
		const parsed = z.string().trim().min(1).max(100).safeParse(value)
		if (!parsed.success) {
			throw new Response(`Invalid ${key} setting`, { status: 400 })
		}
		return parsed.data
	}
	if (key === 'displayedColumns') {
		const parsed = z.string().min(1).max(5_000).safeParse(value)
		if (!parsed.success) {
			throw new Response('Invalid displayed columns setting', { status: 400 })
		}
		return parsed.data
	}
	if (key === 'description') {
		const parsed = z.string().max(5_000).safeParse(value)
		if (!parsed.success) {
			throw new Response('Invalid description setting', { status: 400 })
		}
		return parsed.data
	}
	return value
}

export async function updateWatchlistSettingsCommand(
	ownerId: string,
	watchlistId: string | null,
	rawSettings: unknown,
) {
	const watchlist = await requireOwnedWatchlist(ownerId, watchlistId)
	const settings = z.record(z.unknown()).safeParse(rawSettings)
	if (!settings.success) {
		throw new Response('Invalid settings payload', { status: 400 })
	}

	const listType = await prisma.listType.findUnique({
		where: { id: watchlist.typeId },
		select: { columns: true },
	})
	if (!listType) throw new Response('Invalid list type', { status: 400 })
	const sortableColumns = getSortableWatchlistColumns(listType.columns)

	// Whitelist: keep only editable fields, dropping any others (mass-assignment guard).
	const data: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(settings.data)) {
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
			data[key] = validatedSetting(key, value)
		}
	}

	// Apply the whitelisted settings atomically. Settings do not change list
	// positions, so unrelated sibling rows are deliberately left untouched.
	const updated = await prisma.$transaction(async tx => {
		await serializeUserLibraryMutation(tx, ownerId)
		const current = await tx.watchlist.findFirst({
			where: { id: watchlist.id, ownerId },
		})
		if (!current) throw new Response('Not found', { status: 404 })
		const result =
			Object.keys(data).length > 0
				? await tx.watchlist.update({
						where: { id: current.id },
						data: data as any,
					})
				: current

		if (
			result.isPublic !== current.isPublic ||
			result.header !== current.header
		) {
			await syncWatchlistActivityVisibility(tx, result, current.header)
		}

		return result
	})

	// The client reads the updated watchlist as the last element of the returned array.
	return [updated]
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
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
	return updateWatchlistSettingsCommand(
		ownerId,
		searchParams.get('listId'),
		Object.fromEntries(parsedSettings.data),
	)
}
