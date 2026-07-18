#!/usr/bin/env -S npx tsx
/**
 * Link legacy Entry/UserFavorite snapshots to canonical Media rows using the
 * provider URL embedded in their thumbnail value.
 *
 * Dry-run by default:
 *   npm run media:backfill
 *   npm run media:backfill -- --commit
 *   npm run media:backfill -- --commit --limit 25
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { mediaCatalogSelect } from '#app/utils/media-catalog.ts'
import {
	mediaIdentityFromThumbnail,
	mediaIdentityMatchesListType,
	type MediaIdentity,
} from '#app/utils/media-identity.ts'
import { ensureMediaForIdentity } from '#app/utils/media.server.ts'

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const limitIndex = args.indexOf('--limit')
const parsedLimit =
	limitIndex >= 0 ? Number.parseInt(args[limitIndex + 1] ?? '', 10) : Infinity
if (
	limitIndex >= 0 &&
	(!Number.isSafeInteger(parsedLimit) || parsedLimit < 1)
) {
	throw new Error('--limit must be a positive integer')
}

type Candidate = {
	type: 'entry' | 'favorite'
	id: string
	identity: MediaIdentity
	catalog: Record<string, unknown>
}

function identityKey(identity: MediaIdentity) {
	return `${identity.provider}:${identity.kind}:${identity.externalId}`
}

async function main() {
	const prisma = new PrismaClient()
	try {
		const [entries, favorites] = await Promise.all([
			prisma.entry.findMany({
				where: { mediaId: null },
				select: {
					id: true,
					...mediaCatalogSelect,
					watchlist: { select: { type: { select: { name: true } } } },
				},
			}),
			prisma.userFavorite.findMany({
				where: { mediaId: null },
				select: {
					id: true,
					thumbnail: true,
					title: true,
					mediaType: true,
					startYear: true,
					type: { select: { name: true } },
				},
			}),
		])

		let unrecognized = 0
		let mismatched = 0
		const candidates: Candidate[] = []

		for (const record of entries) {
			const identity = mediaIdentityFromThumbnail(record.thumbnail)
			if (!identity) {
				unrecognized++
				continue
			}
			if (!mediaIdentityMatchesListType(identity, record.watchlist.type.name)) {
				mismatched++
				continue
			}
			candidates.push({
				type: 'entry',
				id: record.id,
				identity,
				catalog: record as unknown as Record<string, unknown>,
			})
		}

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
				catalog: {
					thumbnail: record.thumbnail,
					title: record.title,
					type: record.mediaType,
					...(identity.kind === 'anime'
						? { startSeason: record.startYear }
						: identity.kind === 'manga'
							? { startYear: record.startYear }
							: { airYear: record.startYear }),
				},
			})
		}

		const selected = candidates.slice(0, parsedLimit)
		const grouped = new Map<string, Candidate[]>()
		for (const candidate of selected) {
			const key = identityKey(candidate.identity)
			const group = grouped.get(key) ?? []
			group.push(candidate)
			grouped.set(key, group)
		}

		console.log(
			[
				`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
				`Unlinked records scanned: ${entries.length + favorites.length}`,
				`Records eligible: ${candidates.length}`,
				`Records selected: ${selected.length}`,
				`Canonical identities selected: ${grouped.size}`,
				`Unrecognized provider links: ${unrecognized}`,
				`Provider/list mismatches: ${mismatched}`,
			].join('\n'),
		)

		if (!commit || selected.length === 0) return

		let linkedEntries = 0
		let linkedFavorites = 0
		const groups = [...grouped.values()]
		const batchSize = 100
		for (let offset = 0; offset < groups.length; offset += batchSize) {
			const batch = groups.slice(offset, offset + batchSize)
			await prisma.$transaction(async tx => {
				for (const group of batch) {
					const identity = group[0]?.identity
					if (!identity) continue

					const catalog =
						group.find(candidate => candidate.type === 'entry')?.catalog ??
						group[0]?.catalog
					const mediaId = await ensureMediaForIdentity(tx, identity, catalog)
					const entryIds = group
						.filter(candidate => candidate.type === 'entry')
						.map(candidate => candidate.id)
					const favoriteIds = group
						.filter(candidate => candidate.type === 'favorite')
						.map(candidate => candidate.id)

					if (entryIds.length) {
						const result = await tx.entry.updateMany({
							where: { id: { in: entryIds }, mediaId: null },
							data: { mediaId },
						})
						linkedEntries += result.count
					}
					if (favoriteIds.length) {
						const result = await tx.userFavorite.updateMany({
							where: { id: { in: favoriteIds }, mediaId: null },
							data: { mediaId },
						})
						linkedFavorites += result.count
					}
				}
			})
		}

		console.log(
			`Linked ${linkedEntries} entries and ${linkedFavorites} favorites.`,
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
