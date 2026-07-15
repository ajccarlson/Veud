import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

/**
 * Authorization helpers for the watchlist "fetch" API routes.
 *
 * These routes were previously "protected" by a single shared secret (VEUD_API_KEY)
 * that was shipped to the browser, and they acted on whatever id/ownerId the caller
 * supplied — so any visitor could read the key and mutate any user's data. They now
 * authenticate the real logged-in user (session cookie) and verify that the user owns
 * the specific record being touched.
 */

/**
 * Require the logged-in user to own `watchlistId`. Returns { userId, watchlist }.
 * Responds 404 (not 403) so a watchlist's existence isn't disclosed to non-owners.
 */
export async function requireWatchlistOwner(
	request: Request,
	watchlistId: string | null | undefined,
) {
	const userId = await requireUserId(request)
	const watchlist = watchlistId
		? await prisma.watchlist.findUnique({ where: { id: watchlistId } })
		: null
	if (!watchlist || watchlist.ownerId !== userId) {
		throw new Response('Not found', { status: 404 })
	}
	return { userId, watchlist }
}

/**
 * Require the logged-in user to own the watchlist that `entryId` belongs to.
 * Returns { userId, entry, watchlist }.
 */
export async function requireEntryOwner(
	request: Request,
	entryId: string | null | undefined,
) {
	const userId = await requireUserId(request)
	const entry = entryId
		? await prisma.entry.findUnique({ where: { id: entryId } })
		: null
	if (!entry) throw new Response('Not found', { status: 404 })
	const watchlist = await prisma.watchlist.findUnique({
		where: { id: entry.watchlistId },
	})
	if (!watchlist || watchlist.ownerId !== userId) {
		throw new Response('Not found', { status: 404 })
	}
	return { userId, entry, watchlist }
}

/** Require the logged-in user to own the favorite `favoriteId`. */
export async function requireFavoriteOwner(
	request: Request,
	favoriteId: string | null | undefined,
) {
	const userId = await requireUserId(request)
	const favorite = favoriteId
		? await prisma.userFavorite.findUnique({ where: { id: favoriteId } })
		: null
	if (!favorite || favorite.ownerId !== userId) {
		throw new Response('Not found', { status: 404 })
	}
	return { userId, favorite }
}

/**
 * Returns a shallow copy of `data` with the given protected keys removed. Used to stop a
 * client from mass-assigning system fields (id, ownerId, watchlistId, …) through routes
 * that pass a client-supplied object straight into a Prisma create/update.
 */
export function stripProtectedFields<T extends Record<string, unknown>>(
	data: T,
	protectedKeys: readonly string[],
): Partial<T> {
	const clean: Partial<T> = {}
	for (const key of Object.keys(data)) {
		if (!protectedKeys.includes(key)) {
			clean[key as keyof T] = data[key as keyof T]
		}
	}
	return clean
}
