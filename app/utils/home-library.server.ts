import { prisma } from './db.server.ts'

const mediaGroups = [
	{
		key: 'liveaction',
		label: 'Live action',
		mediaKinds: ['movie', 'tv'],
	},
	{ key: 'anime', label: 'Anime', mediaKinds: ['anime'] },
	{ key: 'manga', label: 'Manga', mediaKinds: ['manga'] },
] as const

export type HomeLibrarySummary = {
	totalTitles: number
	meanScore: number | null
	repeatCount: number
	groups: Array<{
		key: (typeof mediaGroups)[number]['key']
		label: string
		count: number
	}>
}

/**
 * Keep the homepage summary intentionally small. Aggregate queries avoid
 * loading a member's complete tracking history just to render three counters.
 */
export async function getHomeLibrarySummary(
	ownerId: string,
): Promise<HomeLibrarySummary> {
	const [totals, ...groupCounts] = await Promise.all([
		prisma.trackingState.aggregate({
			where: { ownerId },
			_count: { _all: true },
			_avg: { score: true },
			_sum: { repeatCount: true },
		}),
		...mediaGroups.map(group =>
			prisma.trackingState.count({
				where: {
					ownerId,
					media: { kind: { in: [...group.mediaKinds] } },
				},
			}),
		),
	])
	const meanScore =
		totals._avg.score === null ? null : Number(totals._avg.score)

	return {
		totalTitles: totals._count._all,
		meanScore:
			meanScore !== null && Number.isFinite(meanScore) ? meanScore : null,
		repeatCount: totals._sum.repeatCount ?? 0,
		groups: mediaGroups.map((group, index) => ({
			key: group.key,
			label: group.label,
			count: groupCounts[index] ?? 0,
		})),
	}
}
