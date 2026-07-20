import { type Prisma } from '@prisma/client'
import { syncTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'

export class EntryOrderError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404,
	) {
		super(message)
		this.name = 'EntryOrderError'
	}
}

function clampPosition(position: number | null, maximum: number) {
	if (position === null) return maximum
	return Math.min(Math.max(Math.trunc(position), 1), maximum)
}

async function persistOrder(
	tx: Prisma.TransactionClient,
	watchlistId: string,
	entryIds: string[],
) {
	for (const [index, id] of entryIds.entries()) {
		await tx.entry.update({
			where: { id },
			data: { watchlistId, position: index + 1 },
		})
	}
}

export async function normalizeEntryPositions(
	tx: Prisma.TransactionClient,
	watchlistId: string,
) {
	const entries = await tx.entry.findMany({
		where: { watchlistId },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
		select: { id: true, position: true },
	})
	for (const [index, entry] of entries.entries()) {
		if (entry.position !== index + 1) {
			await tx.entry.update({
				where: { id: entry.id },
				data: { position: index + 1 },
			})
		}
	}
	return entries.length
}

export async function setWatchlistEntryOrder(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		watchlistId: string
		entryIds: string[]
	},
) {
	const watchlist = await tx.watchlist.findFirst({
		where: { id: input.watchlistId, ownerId: input.ownerId },
		select: { id: true },
	})
	if (!watchlist) throw new EntryOrderError('Watchlist not found', 404)
	if (new Set(input.entryIds).size !== input.entryIds.length) {
		throw new EntryOrderError('Entry order contains duplicates', 400)
	}

	const currentEntries = await tx.entry.findMany({
		where: { watchlistId: watchlist.id },
		select: { id: true },
	})
	const currentIds = new Set(currentEntries.map(entry => entry.id))
	if (
		currentEntries.length !== input.entryIds.length ||
		input.entryIds.some(id => !currentIds.has(id))
	) {
		throw new EntryOrderError('Entry order is stale or incomplete', 400)
	}

	await persistOrder(tx, watchlist.id, input.entryIds)
	await tx.watchlist.update({
		where: { id: watchlist.id },
		data: { updatedAt: new Date() },
	})
	return tx.entry.findMany({
		where: { watchlistId: watchlist.id },
		orderBy: { position: 'asc' },
	})
}

export async function moveEntryToWatchlist(
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string
		entryId: string
		destinationWatchlistId: string
		position: number | null
	},
) {
	const entry = await tx.entry.findUnique({
		where: { id: input.entryId },
		include: {
			watchlist: { select: { id: true, ownerId: true, typeId: true } },
		},
	})
	const destination = await tx.watchlist.findFirst({
		where: { id: input.destinationWatchlistId, ownerId: input.ownerId },
		select: { id: true, typeId: true },
	})
	if (!entry || entry.watchlist.ownerId !== input.ownerId || !destination) {
		throw new EntryOrderError('Entry or watchlist not found', 404)
	}
	if (entry.watchlist.typeId !== destination.typeId) {
		throw new EntryOrderError(
			'Entries can only move between compatible lists',
			400,
		)
	}

	const sourceWatchlistId = entry.watchlist.id
	if (sourceWatchlistId === destination.id) {
		const orderedIds = (
			await tx.entry.findMany({
				where: { watchlistId: sourceWatchlistId },
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				select: { id: true },
			})
		).map(row => row.id)
		const oldIndex = orderedIds.indexOf(entry.id)
		orderedIds.splice(oldIndex, 1)
		const position = clampPosition(input.position, orderedIds.length + 1)
		orderedIds.splice(position - 1, 0, entry.id)
		await persistOrder(tx, sourceWatchlistId, orderedIds)
	} else {
		const sourceIds = (
			await tx.entry.findMany({
				where: { watchlistId: sourceWatchlistId, id: { not: entry.id } },
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				select: { id: true },
			})
		).map(row => row.id)
		const destinationIds = (
			await tx.entry.findMany({
				where: { watchlistId: destination.id },
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				select: { id: true },
			})
		).map(row => row.id)
		const position = clampPosition(input.position, destinationIds.length + 1)
		destinationIds.splice(position - 1, 0, entry.id)

		await persistOrder(tx, sourceWatchlistId, sourceIds)
		await persistOrder(tx, destination.id, destinationIds)
	}

	await syncTrackingStateForEntry(tx, entry.id)
	for (const watchlistId of new Set([sourceWatchlistId, destination.id])) {
		await tx.watchlist.update({
			where: { id: watchlistId },
			data: { updatedAt: new Date() },
		})
	}
	return tx.entry.findUniqueOrThrow({ where: { id: entry.id } })
}
