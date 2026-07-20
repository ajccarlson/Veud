import { type Prisma } from '@prisma/client'
import { prisma } from './db.server.ts'
import { splitLegacyThumbnail } from './media-detail.ts'
import { type MediaIdentity } from './media-identity.ts'
import {
	inverseMediaRelationType,
	mediaRelationLabel,
	type MediaRelationCandidate,
	type MediaRelationType,
} from './media-relations.ts'
import { ensureMediaForIdentity } from './media.server.ts'

const relatedMediaSelect = {
	id: true,
	kind: true,
	thumbnail: true,
	title: true,
	type: true,
	releaseStart: true,
	startSeason: true,
	startYear: true,
	airYear: true,
	trackingStates: {
		select: {
			statusWatchlistId: true,
			statusWatchlist: { select: { isPublic: true } },
		},
	},
} satisfies Prisma.MediaSelect

type RelatedMedia = Prisma.MediaGetPayload<{
	select: typeof relatedMediaSelect
}>

function yearFor(media: RelatedMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	const fallback = media.startYear || media.airYear || media.startSeason
	return fallback?.match(/\b\d{4}\b/)?.[0] ?? null
}

function chronologyFor(media: RelatedMedia) {
	if (media.releaseStart) return media.releaseStart.getTime()
	const fallback = [media.startSeason, media.startYear, media.airYear]
		.filter(Boolean)
		.join(' ')
	const year = fallback.match(/\b\d{4}\b/)?.[0]
	if (!year) return null
	const season = fallback.toLowerCase().match(/winter|spring|summer|fall/)?.[0]
	const month =
		season === 'spring'
			? 3
			: season === 'summer'
				? 6
				: season === 'fall'
					? 9
					: 0
	return Date.UTC(Number(year), month)
}

function titleCase(value: string) {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, character => character.toUpperCase())
}

function relationTypeForCurrentMedia(
	relationType: string,
	isSource: boolean,
): MediaRelationType {
	const type = relationType as MediaRelationType
	return isSource ? type : inverseMediaRelationType(type)
}

/** Return deterministic, perspective-aware groups for a canonical title page. */
export async function getMediaRelations(
	mediaId: string,
	viewerId?: string | null,
) {
	const rows = await prisma.mediaRelation.findMany({
		where: {
			OR: [{ sourceMediaId: mediaId }, { targetMediaId: mediaId }],
		},
		select: {
			id: true,
			relationType: true,
			sourceMediaId: true,
			sourceMedia: { select: relatedMediaSelect },
			targetMedia: { select: relatedMediaSelect },
		},
	})
	const relatedMediaIds = [
		...new Set(
			rows.map(row =>
				row.sourceMediaId === mediaId ? row.targetMedia.id : row.sourceMedia.id,
			),
		),
	]
	const viewerRows =
		viewerId && relatedMediaIds.length
			? await prisma.trackingState.findMany({
					where: { ownerId: viewerId, mediaId: { in: relatedMediaIds } },
					select: {
						mediaId: true,
						status: true,
						score: true,
						statusWatchlist: { select: { header: true } },
					},
				})
			: []
	const viewerTrackingByMedia = new Map(
		viewerRows.map(row => [
			row.mediaId,
			{
				status: row.status,
				statusLabel:
					row.statusWatchlist?.header.trim() ||
					titleCase(row.status || 'tracked'),
				score: row.score === null ? null : Number(row.score),
			},
		]),
	)

	const unique = new Map<
		string,
		{
			relationType: MediaRelationType
			label: string
			media: {
				id: string
				kind: string
				title: string
				thumbnail: string | null
				imageUrl: string | null
				type: string | null
				year: string | null
				trackerCount: number
				viewerTracking: {
					status: string
					statusLabel: string
					score: number | null
				} | null
				chronology: number | null
			}
		}
	>()

	for (const row of rows) {
		const isSource = row.sourceMediaId === mediaId
		const media = isSource ? row.targetMedia : row.sourceMedia
		const relationType = relationTypeForCurrentMedia(row.relationType, isSource)
		const key = `${relationType}:${media.id}`
		if (unique.has(key)) continue
		unique.set(key, {
			relationType,
			label: mediaRelationLabel(relationType),
			media: {
				id: media.id,
				kind: media.kind,
				title: media.title?.trim() || `Untitled ${media.kind}`,
				thumbnail: media.thumbnail,
				imageUrl: splitLegacyThumbnail(media.thumbnail).imageUrl,
				type: media.type,
				year: yearFor(media),
				trackerCount: media.trackingStates.filter(
					state =>
						state.statusWatchlistId === null ||
						state.statusWatchlist?.isPublic,
				).length,
				viewerTracking: viewerTrackingByMedia.get(media.id) ?? null,
				chronology: chronologyFor(media),
			},
		})
	}

	const items = [...unique.values()].sort(
		(left, right) =>
			left.label.localeCompare(right.label) ||
			(left.media.chronology === null
				? right.media.chronology === null
					? 0
					: 1
				: right.media.chronology === null
					? -1
					: left.media.chronology - right.media.chronology) ||
			left.media.title.localeCompare(right.media.title) ||
			left.media.id.localeCompare(right.media.id),
	)
	const groups = new Map<string, (typeof items)[number][]>()
	for (const item of items) {
		const group = groups.get(item.relationType) ?? []
		group.push(item)
		groups.set(item.relationType, group)
	}

	return [...groups.entries()].map(([relationType, groupItems]) => ({
		relationType: relationType as MediaRelationType,
		label:
			groupItems[0]?.label ??
			mediaRelationLabel(relationType as MediaRelationType),
		items: groupItems.map(item => {
			const { chronology: _, ...media } = item.media
			return media
		}),
	}))
}

/**
 * Replace one provider's outgoing relation snapshot. Related works are resolved
 * through their external identities, creating lightweight canonical records
 * until a richer provider payload hydrates them later.
 */
export async function syncMediaRelations(
	tx: Prisma.TransactionClient,
	input: {
		sourceMediaId: string
		sourceIdentity: MediaIdentity
		relations: MediaRelationCandidate[]
	},
) {
	const deduplicated = new Map<string, MediaRelationCandidate>()
	for (const relation of input.relations) {
		const target = relation.targetIdentity
		const key = `${relation.relationType}:${target.provider}:${target.kind}:${target.externalId}`
		deduplicated.set(key, relation)
	}

	const retainedIds: string[] = []
	for (const relation of deduplicated.values()) {
		const targetMediaId = await ensureMediaForIdentity(
			tx,
			relation.targetIdentity,
			relation.targetCatalog,
		)
		if (targetMediaId === input.sourceMediaId) continue
		const saved = await tx.mediaRelation.upsert({
			where: {
				sourceMediaId_targetMediaId_relationType: {
					sourceMediaId: input.sourceMediaId,
					targetMediaId,
					relationType: relation.relationType,
				},
			},
			update: { provider: input.sourceIdentity.provider },
			create: {
				sourceMediaId: input.sourceMediaId,
				targetMediaId,
				relationType: relation.relationType,
				provider: input.sourceIdentity.provider,
			},
			select: { id: true },
		})
		retainedIds.push(saved.id)
	}

	await tx.mediaRelation.deleteMany({
		where: {
			sourceMediaId: input.sourceMediaId,
			provider: input.sourceIdentity.provider,
			...(input.sourceIdentity.provider === 'tmdb'
				? { relationType: 'franchise' }
				: {}),
			...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
		},
	})
}
