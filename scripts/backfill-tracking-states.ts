#!/usr/bin/env -S npx tsx
/**
 * Build one normalized TrackingState per owner/canonical-media pair from the
 * existing Entry snapshot and history fields.
 *
 * Dry-run by default:
 *   npm run tracking:backfill
 *   npm run tracking:backfill -- --commit --limit 25
 *   npm run tracking:backfill -- --commit
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { ensureTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import { trackingStateFromEntry } from '#app/utils/tracking-state.ts'

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

async function main() {
	const prisma = new PrismaClient()
	try {
		const entries = await prisma.entry.findMany({
			where: {
				mediaId: { not: null },
				trackingStateId: null,
			},
			include: {
				watchlist: { select: { id: true, name: true, ownerId: true } },
				media: { select: { kind: true } },
			},
		})

		const groups = new Map<string, typeof entries>()
		for (const entry of entries) {
			if (!entry.mediaId || !entry.media) continue
			const key = `${entry.watchlist.ownerId}:${entry.mediaId}`
			const group = groups.get(key) ?? []
			group.push(entry)
			groups.set(key, group)
		}

		let statusConflicts = 0
		for (const group of groups.values()) {
			const statuses = new Set(group.map(entry => entry.watchlist.name))
			if (statuses.size > 1) statusConflicts++
			group.sort((a, b) => {
				const aUpdated = trackingStateFromEntry(a, {
					status: a.watchlist.name,
					statusWatchlistId: a.watchlist.id,
					mediaKind: a.media?.kind ?? 'unknown',
				}).sourceUpdatedAt
				const bUpdated = trackingStateFromEntry(b, {
					status: b.watchlist.name,
					statusWatchlistId: b.watchlist.id,
					mediaKind: b.media?.kind ?? 'unknown',
				}).sourceUpdatedAt
				return bUpdated - aUpdated || a.id.localeCompare(b.id)
			})
		}

		const selectedGroups = [...groups.values()].slice(0, parsedLimit)
		const selectedEntries = selectedGroups.reduce(
			(total, group) => total + group.length,
			0,
		)
		console.log(
			[
				`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
				`Unlinked canonical entries scanned: ${entries.length}`,
				`Tracking states eligible: ${groups.size}`,
				`Tracking states selected: ${selectedGroups.length}`,
				`Entries selected: ${selectedEntries}`,
				`Duplicate owner/media entries: ${Math.max(0, entries.length - groups.size)}`,
				`Groups with conflicting watchlist statuses: ${statusConflicts}`,
			].join('\n'),
		)

		if (!commit || selectedGroups.length === 0) return

		let linkedEntries = 0
		const batchSize = 100
		for (let offset = 0; offset < selectedGroups.length; offset += batchSize) {
			const batch = selectedGroups.slice(offset, offset + batchSize)
			await prisma.$transaction(async tx => {
				for (const group of batch) {
					const authoritative = group[0]
					if (!authoritative?.mediaId || !authoritative.media) continue
					const trackingStateId = await ensureTrackingStateForEntry(tx, {
						ownerId: authoritative.watchlist.ownerId,
						mediaId: authoritative.mediaId,
						mediaKind: authoritative.media.kind,
						status: authoritative.watchlist.name,
						statusWatchlistId: authoritative.watchlist.id,
						entry: authoritative,
						mode: 'none',
					})
					const result = await tx.entry.updateMany({
						where: {
							id: { in: group.map(entry => entry.id) },
							trackingStateId: null,
						},
						data: { trackingStateId },
					})
					linkedEntries += result.count
				}
			})
		}

		console.log(
			`Linked ${linkedEntries} entries across ${selectedGroups.length} tracking states.`,
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
