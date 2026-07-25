import { type Prisma } from '@prisma/client'
import { parseStoredNextRelease } from './release-calendar.server.ts'

const SCHEDULE_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1_000

/**
 * Mirror a provider's authoritative next-release payload into a queryable
 * occurrence. This remains inside the same catalog transaction as Media so a
 * cleared or rescheduled provider response cannot leave a stale calendar row.
 */
export async function syncNextReleaseOccurrence(
	tx: Prisma.TransactionClient,
	mediaId: string,
	value: unknown,
) {
	if (value === null) {
		await tx.releaseOccurrence.deleteMany({
			where: { mediaId, source: { in: ['anilist', 'tmdb'] } },
		})
		return
	}
	if (typeof value !== 'string') return
	const release = parseStoredNextRelease(value)
	if (!release?.source || !release.observedAt) return

	const eventType =
		release.chapter !== null
			? 'chapter'
			: release.episode !== null
				? 'episode'
				: 'release'
	const integer = (number: number | null) =>
		number === null ? null : Math.max(1, Math.trunc(number))
	await tx.releaseOccurrence.upsert({
		where: {
			mediaId_source_sourceKey: {
				mediaId,
				source: release.source,
				sourceKey: 'next',
			},
		},
		create: {
			mediaId,
			source: release.source,
			sourceKey: 'next',
			eventType,
			releaseAt: release.releaseAt,
			allDay: release.allDay,
			season: integer(release.season),
			episode: integer(release.episode),
			volume: integer(release.volume),
			chapter: integer(release.chapter),
			name: release.name,
			observedAt: release.observedAt,
			expiresAt: new Date(release.observedAt.getTime() + SCHEDULE_FRESHNESS_MS),
		},
		update: {
			eventType,
			releaseAt: release.releaseAt,
			allDay: release.allDay,
			season: integer(release.season),
			episode: integer(release.episode),
			volume: integer(release.volume),
			chapter: integer(release.chapter),
			name: release.name,
			status: 'scheduled',
			observedAt: release.observedAt,
			expiresAt: new Date(release.observedAt.getTime() + SCHEDULE_FRESHNESS_MS),
		},
	})
}
