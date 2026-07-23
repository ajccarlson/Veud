import { type PrismaClient } from '@prisma/client'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { type LibraryImportItem } from './library-import.ts'

export type LibraryImportResolution = LibraryImportItem & {
	match:
		| {
				state: 'matched'
				mediaId: string
				title: string
				method: 'external-id' | 'exact-title'
		  }
		| {
				state: 'ambiguous'
				candidates: Array<{ mediaId: string; title: string }>
		  }
		| { state: 'unmatched' }
	existing: {
		status: string
		score: number | null
		repeatCount: number
	} | null
}

function catalogProvider(provider: LibraryImportItem['provider']) {
	if (provider === 'myanimelist') return 'mal'
	return provider
}

export async function reconcileLibraryImport(
	prisma: Pick<PrismaClient, 'media' | 'trackingState'>,
	ownerId: string,
	items: LibraryImportItem[],
): Promise<LibraryImportResolution[]> {
	if (items.length > 2_000) {
		throw new Error('Import previews are limited to 2,000 items per batch.')
	}
	const resolutions: LibraryImportResolution[] = []
	for (const item of items) {
		const provider = catalogProvider(item.provider)
		const externalMatches = item.externalId
			? await prisma.media.findMany({
					where: {
						kind: item.mediaKind,
						externalIds: {
							some: {
								provider,
								externalId: item.externalId,
							},
						},
					},
					select: { id: true, title: true },
					take: 3,
				})
			: []
		const titleMatches = externalMatches.length
			? []
			: await prisma.media.findMany({
					where: {
						kind: item.mediaKind,
						OR: [
							{ title: item.title },
							{
								titles: {
									some: { normalized: normalizeCatalogTitle(item.title) },
								},
							},
						],
					},
					select: { id: true, title: true },
					orderBy: [{ catalogPopularity: 'desc' }, { id: 'asc' }],
					take: 3,
				})
		const candidates = externalMatches.length ? externalMatches : titleMatches
		const exact = candidates.length === 1 ? candidates[0] : null
		const existing = exact
			? await prisma.trackingState.findUnique({
					where: { ownerId_mediaId: { ownerId, mediaId: exact.id } },
					select: { status: true, score: true, repeatCount: true },
				})
			: null
		resolutions.push({
			...item,
			match: exact
				? {
						state: 'matched',
						mediaId: exact.id,
						title: exact.title ?? item.title,
						method: externalMatches.length ? 'external-id' : 'exact-title',
					}
				: candidates.length
					? {
							state: 'ambiguous',
							candidates: candidates.map(candidate => ({
								mediaId: candidate.id,
								title: candidate.title ?? item.title,
							})),
						}
					: { state: 'unmatched' },
			existing: existing
				? {
						status: existing.status,
						score: existing.score ? Number(existing.score) : null,
						repeatCount: existing.repeatCount,
					}
				: null,
		})
	}
	return resolutions
}
