import { type Prisma } from '@prisma/client'

export const MAX_WATCHLISTS_PER_USER = 100
export const MAX_WATCHLISTS_PER_TYPE = 50
/** Maximum number of watchlists a profile query ever needs to consider. */
export const PROFILE_WATCHLIST_LIMIT = MAX_WATCHLISTS_PER_USER

const libraryMutexes = new WeakMap<object, Map<string, Promise<void>>>()

export class WatchlistLimitError extends Error {
	readonly status = 409

	constructor(
		message: string,
		public readonly limit: 'total' | 'type',
	) {
		super(message)
		this.name = 'WatchlistLimitError'
	}
}

/**
 * Serialize library mutations whose visibility/activity provenance must agree
 * at commit. The non-key no-op keeps the member timestamp unchanged while
 * providing one cross-database transaction lock.
 */
export async function serializeUserLibraryMutation(
	tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
	ownerId: string,
) {
	let transactionMutexes = libraryMutexes.get(tx)
	if (!transactionMutexes) {
		transactionMutexes = new Map()
		libraryMutexes.set(tx, transactionMutexes)
	}
	let acquisition = transactionMutexes.get(ownerId)
	if (!acquisition) {
		acquisition = (async () => {
			await tx.$executeRaw`
				UPDATE "User"
				SET "updatedAt" = "updatedAt"
				WHERE "id" = ${ownerId}
			`
		})()
		transactionMutexes.set(ownerId, acquisition)
	}
	try {
		await acquisition
	} catch (error) {
		if (transactionMutexes.get(ownerId) === acquisition) {
			transactionMutexes.delete(ownerId)
		}
		throw error
	}
}

/** Serialize all list reuse/create decisions for one member. */
export async function serializeWatchlistCreation(
	tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
	ownerId: string,
) {
	await serializeUserLibraryMutation(tx, ownerId)
}

/**
 * Checks watchlist capacity inside the same transaction that creates the list.
 * Callers must reuse an existing destination before invoking this guard.
 */
export async function assertWatchlistCreationAllowed(
	tx: Pick<Prisma.TransactionClient, 'watchlist' | '$executeRaw'>,
	input: { ownerId: string; typeId: string },
) {
	// A harmless row update provides one cross-database, per-owner transaction
	// lock. Concurrent normal creations and imports therefore cannot both pass
	// the count checks at the same boundary.
	await serializeWatchlistCreation(tx, input.ownerId)

	const [totalCount, typeCount] = await Promise.all([
		tx.watchlist.count({ where: { ownerId: input.ownerId } }),
		tx.watchlist.count({
			where: { ownerId: input.ownerId, typeId: input.typeId },
		}),
	])

	if (totalCount >= MAX_WATCHLISTS_PER_USER) {
		throw new WatchlistLimitError(
			`You can have up to ${MAX_WATCHLISTS_PER_USER} watchlists. Delete one before creating another.`,
			'total',
		)
	}
	if (typeCount >= MAX_WATCHLISTS_PER_TYPE) {
		throw new WatchlistLimitError(
			`You can have up to ${MAX_WATCHLISTS_PER_TYPE} watchlists for each media type. Delete one before creating another.`,
			'type',
		)
	}
}
