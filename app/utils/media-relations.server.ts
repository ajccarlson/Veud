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
} satisfies Prisma.MediaSelect

type RelatedMedia = Prisma.MediaGetPayload<{
	select: typeof relatedMediaSelect
}>

function yearFor(media: RelatedMedia) {
	if (media.releaseStart) return String(media.releaseStart.getUTCFullYear())
	const fallback = media.startYear || media.airYear || media.startSeason
	return fallback?.match(/\b\d{4}\b/)?.[0] ?? null
}

function relationTypeForCurrentMedia(
	relationType: string,
	isSource: boolean,
): MediaRelationType {
	const type = relationType as MediaRelationType
	return isSource ? type : inverseMediaRelationType(type)
}

/** Return deterministic, perspective-aware groups for a canonical title page. */
export async function getMediaRelations(mediaId: string) {
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
			},
		})
	}

	const items = [...unique.values()].sort(
		(left, right) =>
			left.label.localeCompare(right.label) ||
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
		items: groupItems.map(item => item.media),
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
			...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
		},
	})
}
