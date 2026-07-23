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
				candidates: Array<{
					mediaId: string
					title: string
					thumbnail: string | null
				}>
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

function identityProvider(item: LibraryImportItem) {
	return item.externalProvider ?? catalogProvider(item.provider)
}

function chunks<T>(values: T[], size = 300) {
	const result: T[][] = []
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size))
	}
	return result
}

function grouped<T>(values: T[], keyFor: (value: T) => string) {
	const result = new Map<string, T[]>()
	for (const value of values) {
		const key = keyFor(value)
		result.set(key, [...(result.get(key) ?? []), value])
	}
	return result
}

function identityKey(provider: string, kind: string, externalId: string) {
	return `${provider}\u0000${kind}\u0000${externalId}`
}

function titleKey(kind: string, title: string) {
	return `${kind}\u0000${normalizeCatalogTitle(title)}`
}

export async function reconcileLibraryImport(
	prisma: Pick<PrismaClient, 'media' | 'trackingState'>,
	ownerId: string,
	items: LibraryImportItem[],
): Promise<LibraryImportResolution[]> {
	if (items.length > 2_000) {
		throw new Error('Import previews are limited to 2,000 items per batch.')
	}
	const externalMatches = new Map<
		string,
		Array<{
			id: string
			title: string | null
			thumbnail: string | null
			catalogPopularity: number | null
		}>
	>()
	const externalGroups = grouped(
		items.filter(item => item.externalId),
		item => `${identityProvider(item)}\u0000${item.mediaKind}`,
	)
	for (const [groupKey, groupItems] of externalGroups) {
		const [provider = '', kind = ''] = groupKey.split('\u0000')
		const externalIds = [
			...new Set(groupItems.flatMap(item => item.externalId ?? [])),
		]
		for (const batch of chunks(externalIds)) {
			const media = await prisma.media.findMany({
				where: {
					kind,
					externalIds: {
						some: { provider, kind, externalId: { in: batch } },
					},
				},
				select: {
					id: true,
					title: true,
					thumbnail: true,
					catalogPopularity: true,
					externalIds: {
						where: { provider, kind, externalId: { in: batch } },
						select: { externalId: true },
					},
				},
			})
			for (const work of media) {
				for (const externalId of work.externalIds) {
					const key = identityKey(provider, kind, externalId.externalId)
					externalMatches.set(key, [
						...(externalMatches.get(key) ?? []),
						{
							id: work.id,
							title: work.title,
							thumbnail: work.thumbnail,
							catalogPopularity: work.catalogPopularity,
						},
					])
				}
			}
		}
	}

	const titleMatches = new Map<
		string,
		Array<{
			id: string
			title: string | null
			thumbnail: string | null
			catalogPopularity: number | null
		}>
	>()
	const titleOnlyItems = items.filter(item => {
		if (!item.externalId) return true
		return !externalMatches.get(
			identityKey(identityProvider(item), item.mediaKind, item.externalId),
		)?.length
	})
	for (const [kind, groupItems] of grouped(
		titleOnlyItems,
		item => item.mediaKind,
	)) {
		for (const batch of chunks(groupItems)) {
			const rawTitles = [...new Set(batch.map(item => item.title))]
			const normalizedTitles = [
				...new Set(batch.map(item => normalizeCatalogTitle(item.title))),
			]
			const media = await prisma.media.findMany({
				where: {
					kind,
					OR: [
						{ title: { in: rawTitles } },
						{ titles: { some: { normalized: { in: normalizedTitles } } } },
					],
				},
				select: {
					id: true,
					title: true,
					thumbnail: true,
					catalogPopularity: true,
					titles: {
						where: { normalized: { in: normalizedTitles } },
						select: { normalized: true },
					},
				},
			})
			for (const work of media) {
				const keys = new Set(work.titles.map(title => title.normalized))
				if (work.title && rawTitles.includes(work.title)) {
					keys.add(normalizeCatalogTitle(work.title))
				}
				for (const normalized of keys) {
					const key = `${kind}\u0000${normalized}`
					const existing = titleMatches.get(key) ?? []
					if (!existing.some(candidate => candidate.id === work.id)) {
						existing.push({
							id: work.id,
							title: work.title,
							thumbnail: work.thumbnail,
							catalogPopularity: work.catalogPopularity,
						})
						titleMatches.set(key, existing)
					}
				}
			}
		}
	}
	for (const matches of titleMatches.values()) {
		matches.sort(
			(a, b) =>
				(b.catalogPopularity ?? -1) - (a.catalogPopularity ?? -1) ||
				a.id.localeCompare(b.id),
		)
	}

	const matchedMediaIds = new Set<string>()
	const preliminary = items.map(item => {
		const byExternal = item.externalId
			? (externalMatches.get(
					identityKey(identityProvider(item), item.mediaKind, item.externalId),
				) ?? [])
			: []
		const matches = (
			byExternal.length
				? byExternal
				: (titleMatches.get(titleKey(item.mediaKind, item.title)) ?? [])
		).slice(0, 3)
		const exact = matches.length === 1 ? matches[0] : null
		if (exact) matchedMediaIds.add(exact.id)
		return { item, byExternal, matches, exact }
	})
	const existingByMediaId = new Map<
		string,
		{ status: string; score: unknown; repeatCount: number }
	>()
	for (const mediaIds of chunks([...matchedMediaIds])) {
		const states = await prisma.trackingState.findMany({
			where: { ownerId, mediaId: { in: mediaIds } },
			select: { mediaId: true, status: true, score: true, repeatCount: true },
		})
		for (const state of states) existingByMediaId.set(state.mediaId, state)
	}

	return preliminary.map(({ item, byExternal, matches, exact }) => {
		const existing = exact ? existingByMediaId.get(exact.id) : null
		return {
			...item,
			match: exact
				? {
						state: 'matched',
						mediaId: exact.id,
						title: exact.title ?? item.title,
						method: byExternal.length ? 'external-id' : 'exact-title',
					}
				: matches.length
					? {
							state: 'ambiguous',
							candidates: matches.map(candidate => ({
								mediaId: candidate.id,
								title: candidate.title ?? item.title,
								thumbnail: candidate.thumbnail,
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
		}
	})
}
