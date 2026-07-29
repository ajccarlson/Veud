#!/usr/bin/env -S npx tsx
/**
 * Link legacy Entry/UserFavorite snapshots to canonical Media rows using the
 * provider URL embedded in their thumbnail value. Legacy snapshots remain
 * user-owned; trusted provider hydration populates the canonical Media rows.
 *
 * Dry-run by default:
 *   npm run media:backfill
 *   npm run media:backfill -- --commit
 *   npm run media:backfill -- --commit --limit 25
 *   npm run media:backfill -- --commit --limit 25 --scan-limit 500
 *
 * --limit caps eligible records selected. --scan-limit caps all unlinked rows
 * inspected across entries and favorites. When --limit is finite and
 * --scan-limit is omitted, the scan limit defaults to the selection limit.
 */
import 'dotenv/config'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
	mediaIdentityFromThumbnail,
	mediaIdentityMatchesListType,
	type MediaIdentity,
} from '#app/utils/media-identity.ts'
import { ensureMediaForIdentity } from '#app/utils/media.server.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)

export type MediaIdentityBackfillCandidate = {
	type: 'entry' | 'favorite'
	id: string
	identity: MediaIdentity
	thumbnail: string
	listTypeId: string
	listTypeName: string
	watchlistId?: string
}

function identityKey(identity: MediaIdentity) {
	return `${identity.provider}:${identity.kind}:${identity.externalId}`
}

const PAGE_SIZE = 500
const IDENTITY_GROUPS_PER_TRANSACTION = 100

export type MediaIdentityBackfillOptions = {
	commit: boolean
	limit: number
	scanLimit: number
}

function positiveInteger(value: string | undefined, flag: string) {
	if (!value || !/^\d+$/.test(value)) {
		throw new Error(`${flag} must be a positive integer`)
	}
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer`)
	}
	return parsed
}

export function parseMediaIdentityBackfillArguments(
	args: string[],
): MediaIdentityBackfillOptions {
	let commit = false
	let limit: number | undefined
	let scanLimit: number | undefined

	for (let index = 0; index < args.length; index++) {
		const argument = args[index]
		switch (argument) {
			case '--commit': {
				if (commit) throw new Error('--commit may only be specified once')
				commit = true
				break
			}
			case '--limit':
			case '--scan-limit': {
				const current = argument === '--limit' ? limit : scanLimit
				if (current !== undefined) {
					throw new Error(`${argument} may only be specified once`)
				}
				const value = positiveInteger(args[index + 1], argument)
				if (argument === '--limit') limit = value
				else scanLimit = value
				index++
				break
			}
			default:
				throw new Error(`Unknown argument: ${argument}`)
		}
	}

	return {
		commit,
		limit: limit ?? Infinity,
		scanLimit: scanLimit ?? limit ?? Infinity,
	}
}

export function mediaIdentityBackfillPageSize({
	selected,
	scanned,
	limit,
	scanLimit,
	pageSize = PAGE_SIZE,
}: {
	selected: number
	scanned: number
	limit: number
	scanLimit: number
	pageSize?: number
}) {
	const remainingSelection = Number.isFinite(limit)
		? Math.max(0, limit - selected)
		: pageSize
	const remainingScan = Number.isFinite(scanLimit)
		? Math.max(0, scanLimit - scanned)
		: pageSize
	return Math.min(pageSize, remainingSelection, remainingScan)
}

function printableLimit(value: number) {
	return Number.isFinite(value) ? String(value) : 'unbounded'
}

/**
 * Link one provider-identity group only while every identity-bearing legacy
 * value still matches the page that selected it. A stale page aborts the whole
 * transaction, including canonical-row creation and hydration requests, so a
 * later run can reselect the edited record safely.
 */
export async function linkMediaIdentityBackfillGroup(
	tx: Prisma.TransactionClient,
	group: MediaIdentityBackfillCandidate[],
) {
	const identity = group[0]?.identity
	if (!identity) return { linkedEntries: 0, linkedFavorites: 0 }
	if (
		group.some(
			candidate => identityKey(candidate.identity) !== identityKey(identity),
		)
	) {
		throw new Error('Media identity backfill group contains mixed identities')
	}

	const mediaId = await ensureMediaForIdentity(tx, identity)
	const entries = group.filter(
		(
			candidate,
		): candidate is MediaIdentityBackfillCandidate & {
			type: 'entry'
			watchlistId: string
		} =>
			candidate.type === 'entry' && typeof candidate.watchlistId === 'string',
	)
	const favorites = group.filter(candidate => candidate.type === 'favorite')
	if (
		entries.length !==
		group.filter(candidate => candidate.type === 'entry').length
	) {
		throw new Error('Media identity backfill entry is missing its watchlist')
	}

	let linkedEntries = 0
	let linkedFavorites = 0
	if (entries.length) {
		const result = await tx.entry.updateMany({
			where: {
				mediaId: null,
				OR: entries.map(candidate => ({
					id: candidate.id,
					thumbnail: candidate.thumbnail,
					watchlistId: candidate.watchlistId,
					watchlist: {
						typeId: candidate.listTypeId,
						type: { name: candidate.listTypeName },
					},
				})),
			},
			data: { mediaId },
		})
		if (result.count !== entries.length) {
			throw new Error(
				'Media identity backfill candidate changed after selection; rerun the backfill',
			)
		}
		linkedEntries = result.count
	}
	if (favorites.length) {
		const result = await tx.userFavorite.updateMany({
			where: {
				mediaId: null,
				OR: favorites.map(candidate => ({
					id: candidate.id,
					thumbnail: candidate.thumbnail,
					typeId: candidate.listTypeId,
					type: { name: candidate.listTypeName },
				})),
			},
			data: { mediaId },
		})
		if (result.count !== favorites.length) {
			throw new Error(
				'Media identity backfill candidate changed after selection; rerun the backfill',
			)
		}
		linkedFavorites = result.count
	}
	return { linkedEntries, linkedFavorites }
}

async function main(args = process.argv.slice(2)) {
	const { commit, limit, scanLimit } = parseMediaIdentityBackfillArguments(args)
	const prisma = new PrismaClient()
	try {
		let scanned = 0
		let unrecognized = 0
		let mismatched = 0
		let eligible = 0
		let selectedCount = 0
		let selectedIdentityGroups = 0
		let linkedEntries = 0
		let linkedFavorites = 0
		const nextPageSize = () =>
			mediaIdentityBackfillPageSize({
				selected: selectedCount,
				scanned,
				limit,
				scanLimit,
			})

		const processCandidates = async (
			candidates: MediaIdentityBackfillCandidate[],
		) => {
			eligible += candidates.length
			const remaining = Number.isFinite(limit)
				? Math.max(0, limit - selectedCount)
				: candidates.length
			const selected = candidates.slice(0, remaining)
			selectedCount += selected.length
			if (!selected.length) return

			const grouped = new Map<string, MediaIdentityBackfillCandidate[]>()
			for (const candidate of selected) {
				const key = identityKey(candidate.identity)
				const group = grouped.get(key) ?? []
				group.push(candidate)
				grouped.set(key, group)
			}
			selectedIdentityGroups += grouped.size
			if (!commit) return

			const groups = [...grouped.values()]
			for (
				let offset = 0;
				offset < groups.length;
				offset += IDENTITY_GROUPS_PER_TRANSACTION
			) {
				const batch = groups.slice(
					offset,
					offset + IDENTITY_GROUPS_PER_TRANSACTION,
				)
				const linked = await prisma.$transaction(async tx => {
					let batchLinkedEntries = 0
					let batchLinkedFavorites = 0
					for (const group of batch) {
						const result = await linkMediaIdentityBackfillGroup(tx, group)
						batchLinkedEntries += result.linkedEntries
						batchLinkedFavorites += result.linkedFavorites
					}
					return {
						linkedEntries: batchLinkedEntries,
						linkedFavorites: batchLinkedFavorites,
					}
				})
				linkedEntries += linked.linkedEntries
				linkedFavorites += linked.linkedFavorites
			}
		}

		let entryCursor: string | undefined
		for (;;) {
			const take = nextPageSize()
			if (!take) break
			const entries = await prisma.entry.findMany({
				where: {
					mediaId: null,
					...(entryCursor ? { id: { gt: entryCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take,
				select: {
					id: true,
					thumbnail: true,
					watchlistId: true,
					watchlist: {
						select: {
							typeId: true,
							type: { select: { name: true } },
						},
					},
				},
			})
			if (!entries.length) break
			scanned += entries.length
			entryCursor = entries.at(-1)?.id
			const candidates: MediaIdentityBackfillCandidate[] = []
			for (const record of entries) {
				const identity = mediaIdentityFromThumbnail(record.thumbnail)
				if (!identity) {
					unrecognized++
					continue
				}
				if (
					!mediaIdentityMatchesListType(identity, record.watchlist.type.name)
				) {
					mismatched++
					continue
				}
				candidates.push({
					type: 'entry',
					id: record.id,
					identity,
					thumbnail: record.thumbnail!,
					listTypeId: record.watchlist.typeId,
					listTypeName: record.watchlist.type.name,
					watchlistId: record.watchlistId,
				})
			}
			await processCandidates(candidates)
		}

		let favoriteCursor: string | undefined
		for (;;) {
			const take = nextPageSize()
			if (!take) break
			const favorites = await prisma.userFavorite.findMany({
				where: {
					mediaId: null,
					...(favoriteCursor ? { id: { gt: favoriteCursor } } : {}),
				},
				orderBy: { id: 'asc' },
				take,
				select: {
					id: true,
					thumbnail: true,
					typeId: true,
					type: { select: { name: true } },
				},
			})
			if (!favorites.length) break
			scanned += favorites.length
			favoriteCursor = favorites.at(-1)?.id
			const candidates: MediaIdentityBackfillCandidate[] = []
			for (const record of favorites) {
				const identity = mediaIdentityFromThumbnail(record.thumbnail)
				if (!identity) {
					unrecognized++
					continue
				}
				if (!mediaIdentityMatchesListType(identity, record.type.name)) {
					mismatched++
					continue
				}
				candidates.push({
					type: 'favorite',
					id: record.id,
					identity,
					thumbnail: record.thumbnail!,
					listTypeId: record.typeId,
					listTypeName: record.type.name,
				})
			}
			await processCandidates(candidates)
		}

		console.log(
			[
				`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
				`Selection limit: ${printableLimit(limit)}`,
				`Scan limit: ${printableLimit(scanLimit)}`,
				`Unlinked records scanned: ${scanned}`,
				`Selection limit reached: ${
					Number.isFinite(limit) && selectedCount >= limit ? 'yes' : 'no'
				}`,
				`Scan limit reached: ${
					Number.isFinite(scanLimit) && scanned >= scanLimit ? 'yes' : 'no'
				}`,
				`Records eligible: ${eligible}`,
				`Records selected: ${selectedCount}`,
				`Canonical identity groups selected: ${selectedIdentityGroups}`,
				`Unrecognized provider links: ${unrecognized}`,
				`Provider/list mismatches: ${mismatched}`,
				...(commit
					? [
							`Linked ${linkedEntries} entries and ${linkedFavorites} favorites.`,
						]
					: []),
			].join('\n'),
		)
	} finally {
		await prisma.$disconnect()
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	main().catch(error => {
		console.error(error)
		process.exitCode = 1
	})
}
