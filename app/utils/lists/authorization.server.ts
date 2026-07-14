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

// The only Prisma models a watchlist entry may live in. This allowlist prevents
// arbitrary `prisma[<client-controlled string>]` delegate access.
const ENTRY_MODELS = new Set(['liveActionEntry', 'animeEntry', 'mangaEntry'])

/**
 * Map a list type's `header` to its validated Prisma entry-model delegate name. Throws a
 * 400 for anything outside the allowlist, so the Prisma client is never indexed with an
 * untrusted string. Shared by the fetch API (via resolveEntryModel) and the page loaders,
 * which previously built this name inline with no validation.
 */
export function entryModelFromHeader(header: unknown): string {
	const base = String(header ?? '').replace(/\W/g, '')
	const delegate = base
		? base.charAt(0).toLowerCase() + base.slice(1) + 'Entry'
		: ''
	if (!ENTRY_MODELS.has(delegate)) {
		throw new Response('Unknown list type', { status: 400 })
	}
	return delegate
}

/**
 * Resolve — and validate — the entry-model delegate name from the client-supplied
 * `listTypeData`. Throws a 400 for anything outside the allowlist, so the Prisma
 * client is never indexed with an untrusted string.
 */
export function resolveEntryModel(listTypeDataRaw: string | null): string {
	let header: unknown
	try {
		header = JSON.parse(listTypeDataRaw ?? '')?.header
	} catch {
		throw new Response('Invalid listTypeData', { status: 400 })
	}
	return entryModelFromHeader(header)
}

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
 * Require the logged-in user to own the watchlist that `entryId` (in the validated
 * `delegate` model) belongs to. Returns { userId, entry, watchlist }.
 */
export async function requireEntryOwner(
	request: Request,
	delegate: string,
	entryId: string | null | undefined,
) {
	const userId = await requireUserId(request)
	// `delegate` is validated by resolveEntryModel; the dynamic access is intentional.
	const entry = entryId
		? await (prisma as any)[delegate].findUnique({ where: { id: entryId } })
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
