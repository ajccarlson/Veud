import { type Prisma, type PrismaClient } from '@prisma/client'
import {
	entryCatalogMetadataFields,
	hasCatalogValue,
} from './media-catalog.ts'

type WatchlistMetadataSyncOptions = {
	batchSize?: number
	commit?: boolean
}

function comparableCatalogValue(value: unknown) {
	if (value instanceof Date) return value.getTime()
	if (
		value &&
		typeof value === 'object' &&
		'toString' in value &&
		typeof value.toString === 'function'
	) {
		return value.toString()
	}
	return value
}

/**
 * Reconcile legacy Entry metadata from canonical Media without touching any
 * member-owned fields. This catches catalog updates made outside the normal
 * hydration path; hydrateMediaCatalog already performs that sync transactionally.
 */
export async function synchronizeWatchlistMetadata(
	prisma: PrismaClient,
	options: WatchlistMetadataSyncOptions = {},
) {
	const batchSize = options.batchSize ?? 500
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 2_000) {
		throw new Error('batchSize must be an integer between 1 and 2000')
	}
	const commit = options.commit ?? false
	let cursor: string | undefined
	let scanned = 0
	let matched = 0
	let updated = 0

	for (;;) {
		const entries = await prisma.entry.findMany({
			where: { mediaId: { not: null } },
			orderBy: { id: 'asc' },
			take: batchSize,
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			include: { media: true },
		})
		if (!entries.length) break
		cursor = entries.at(-1)?.id
		scanned += entries.length

		const changes = entries.flatMap(entry => {
			if (!entry.media) return []
			const data = Object.fromEntries(
				entryCatalogMetadataFields
					.filter(field => hasCatalogValue(entry.media?.[field]))
					.filter(
						field =>
							comparableCatalogValue(entry[field]) !==
							comparableCatalogValue(entry.media?.[field]),
					)
					.map(field => [field, entry.media?.[field]]),
			) as Prisma.EntryUpdateInput
			return Object.keys(data).length ? [{ id: entry.id, data }] : []
		})
		matched += changes.length

		if (commit && changes.length) {
			await prisma.$transaction(
				changes.map(change =>
					prisma.entry.update({
						where: { id: change.id },
						data: change.data,
						select: { id: true },
					}),
				),
			)
			updated += changes.length
		}
	}

	return { dryRun: !commit, scanned, matched, updated }
}
