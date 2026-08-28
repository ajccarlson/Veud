import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
	catalogMediaFields,
	expectedCatalogMergeConfirmation,
	expectedCatalogMergeReversal,
	type CatalogMediaField,
	type CatalogMediaMergePreflight,
} from './catalog-media-merge.ts'
import { TRUSTED_CATALOG_PROVENANCE_VERSION } from './media-catalog.ts'
import {
	deriveNextReleaseAt,
	releaseScheduleSources,
	syncNextReleaseOccurrence,
} from './release-occurrences.server.ts'

const mergeMediaInclude = {
	// provider and tombstonedAt are read when an absorbed TMDB identity has to be
	// tombstoned so hydration cannot claim the surviving anime row.
	externalIds: {
		select: { id: true, provider: true, tombstonedAt: true },
	},
	titles: true,
	catalogFeedItems: true,
	outgoingRelations: {
		where: {
			catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
		},
	},
	incomingRelations: {
		where: {
			catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
		},
	},
	entries: { select: { id: true, watchlistId: true } },
	favorites: { select: { id: true, ownerId: true, typeId: true } },
	trackingStates: { select: { id: true, ownerId: true } },
	seasons: { select: { id: true, number: true } },
	installments: {
		select: {
			id: true,
			kind: true,
			seasonNumber: true,
			number: true,
		},
	},
	consumptionEvents: { select: { id: true } },
	activityEvents: { select: { id: true } },
	reviews: { select: { id: true, authorId: true } },
	diaryEntries: { select: { id: true } },
	collectionItems: { select: { id: true, collectionId: true } },
	releaseReminders: { select: { id: true, ownerId: true } },
	releaseOccurrences: true,
	primaryQualityIssues: {
		select: { id: true, primaryMediaId: true, secondaryMediaId: true },
	},
	secondaryQualityIssues: {
		select: { id: true, primaryMediaId: true, secondaryMediaId: true },
	},
	catalogMetricSnapshots: {
		select: {
			id: true,
			provider: true,
			kind: true,
			observedAt: true,
		},
	},
	recommendationFeedback: { select: { id: true, ownerId: true } },
	libraryImportItems: { select: { id: true } },
	// Provider-owned rows. Both cascade when a Media is deleted, so a merge that
	// does not carry them forward destroys them silently: the losing row's
	// streaming offers, and its whole cast and crew.
	watchAvailability: {
		select: { id: true, region: true, offerKind: true, providerId: true },
	},
	credits: {
		select: {
			id: true,
			personId: true,
			creditType: true,
			role: true,
			department: true,
		},
	},
} satisfies Prisma.MediaInclude

type MergeMedia = Prisma.MediaGetPayload<{
	include: typeof mergeMediaInclude
}>

type MergeTransaction = Prisma.TransactionClient
const writeTransactionOptions = {
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
	maxWait: 5_000,
	timeout: 30_000,
} as const

type MergeBlocker = {
	code: string
	message: string
	count: number
	examples: string[]
}

type RelationPlan = {
	move: Array<{
		id: string
		sourceMediaId: string
		targetMediaId: string
		nextSourceMediaId: string
		nextTargetMediaId: string
	}>
	prune: Prisma.MediaRelationGetPayload<object>[]
}

type MergeContext = {
	issue: {
		id: string
		status: string
		issueType: string
		evidence: string | null
		primaryMediaId: string
		secondaryMediaId: string | null
	}
	source: MergeMedia
	target: MergeMedia
	activeMergeIds: string[]
	titlePrunes: MergeMedia['titles']
	feedPrunes: MergeMedia['catalogFeedItems']
	relationPlan: RelationPlan
	targetFills: Partial<Record<CatalogMediaField, unknown>>
	targetConflicts: CatalogMediaField[]
	blockers: MergeBlocker[]
}

type MergeJournal = {
	version: 1
	inventoryVersion?: 3 | 4
	appliedAt: string
	sourceMedia: Record<string, unknown>
	targetPatch: {
		previous: Partial<Record<CatalogMediaField, unknown>>
		applied: Partial<Record<CatalogMediaField, unknown>>
	}
	moved: {
		externalIds: string[]
		titles: string[]
		catalogFeedItems: string[]
		entries: string[]
		favorites: string[]
		trackingStates: string[]
		seasons?: string[]
		installments?: string[]
		consumptionEvents?: string[]
		activityEvents: string[]
		reviews: string[]
		diaryEntries: string[]
		collectionItems: string[]
		releaseReminders: string[]
		releaseOccurrences?: string[]
		catalogMetricSnapshots?: string[]
		recommendationFeedback?: string[]
		libraryImportItems?: string[]
		watchAvailability?: string[]
		credits?: string[]
		/** Absorbed TMDB identities tombstoned so hydration cannot claim the
		 * surviving anime row. Cleared again on revert. */
		tombstonedExternalIds?: string[]
		relations: RelationPlan['move']
	}
	pruned: {
		titles: MergeMedia['titles']
		catalogFeedItems: MergeMedia['catalogFeedItems']
		relations: MergeMedia['outgoingRelations']
	}
	qualityIssues: Array<{
		id: string
		primaryMediaId: string
		secondaryMediaId: string | null
	}>
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
		return `{${entries.join(',')}}`
	}
	return value === undefined ? 'null' : JSON.stringify(value)
}

function hash(value: unknown) {
	return createHash('sha256').update(stableJson(value)).digest('hex')
}

function serializedValue(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString()
	if (
		value &&
		typeof value === 'object' &&
		'toString' in value &&
		value.constructor?.name === 'Decimal'
	) {
		return String(value)
	}
	return value
}

function serializedRow<T extends Record<string, unknown>>(row: T) {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [key, serializedValue(value)]),
	)
}

function serializedMedia(media: MergeMedia) {
	return serializedRow({
		id: media.id,
		kind: media.kind,
		catalogProvenanceVersion: media.catalogProvenanceVersion,
		...Object.fromEntries(
			catalogMediaFields.map(field => [field, media[field]]),
		),
		createdAt: media.createdAt,
		updatedAt: media.updatedAt,
	})
}

function comparableValue(value: unknown) {
	return stableJson(serializedValue(value))
}

function missingValue(value: unknown) {
	return value === null || value === undefined || value === ''
}

function keyed<T>(rows: T[], keyFor: (row: T) => string) {
	return new Map(rows.map(row => [keyFor(row), row]))
}

function titleKey(title: MergeMedia['titles'][number]) {
	return stableJson([
		title.provider,
		title.language,
		title.titleType,
		title.value,
	])
}

function feedKey(feed: MergeMedia['catalogFeedItems'][number]) {
	return stableJson([feed.provider, feed.kind, feed.feed])
}

function seasonKey(season: MergeMedia['seasons'][number]) {
	return String(season.number)
}

function installmentKey(installment: MergeMedia['installments'][number]) {
	return stableJson([
		installment.kind,
		installment.seasonNumber,
		installment.number,
	])
}

function releaseOccurrenceKey(
	occurrence: MergeMedia['releaseOccurrences'][number],
) {
	return stableJson([occurrence.source, occurrence.sourceKey])
}

function isDerivedNextReleaseOccurrence(
	occurrence: MergeMedia['releaseOccurrences'][number],
) {
	return (
		occurrence.sourceKey === 'next' &&
		(releaseScheduleSources as readonly string[]).includes(occurrence.source)
	)
}

function movableReleaseOccurrences(media: MergeMedia) {
	return media.releaseOccurrences.filter(
		occurrence => !isDerivedNextReleaseOccurrence(occurrence),
	)
}

function metricSnapshotKey(
	snapshot: MergeMedia['catalogMetricSnapshots'][number],
) {
	return stableJson([
		snapshot.provider,
		snapshot.kind,
		snapshot.observedAt.toISOString(),
	])
}

/** The unique constraint on WatchAvailability: one offer per region and kind. */
function watchAvailabilityKey(offer: MergeMedia['watchAvailability'][number]) {
	return stableJson([offer.region, offer.offerKind, offer.providerId])
}

/** The unique constraint on MediaCredit: one person per role per department. */
function creditKey(credit: MergeMedia['credits'][number]) {
	return stableJson([
		credit.personId,
		credit.creditType,
		credit.role,
		credit.department,
	])
}

function relationKey(input: {
	sourceMediaId: string
	targetMediaId: string
	relationType: string
}) {
	return stableJson([
		input.sourceMediaId,
		input.targetMediaId,
		input.relationType,
	])
}

function uniqueById<T extends { id: string }>(rows: T[]) {
	return [...new Map(rows.map(row => [row.id, row])).values()]
}

function collisionBlocker(
	code: string,
	label: string,
	sourceValues: string[],
	targetValues: string[],
) {
	const targets = new Set(targetValues)
	const collisions = sourceValues.filter(value => targets.has(value))
	const examples = [...new Set(collisions)].slice(0, 10)
	if (!examples.length) return null
	const count = new Set(collisions).size
	return {
		code,
		message: `${count} ${label}${count === 1 ? '' : 's'} already reference both records.`,
		count,
		examples,
	} satisfies MergeBlocker
}

function relationPlan(source: MergeMedia, target: MergeMedia): RelationPlan {
	const sourceRelations = uniqueById([
		...source.outgoingRelations,
		...source.incomingRelations,
	])
	const targetRelations = uniqueById([
		...target.outgoingRelations,
		...target.incomingRelations,
	])
	const existing = keyed(targetRelations, relationKey)
	const move: RelationPlan['move'] = []
	const prune: RelationPlan['prune'] = []
	for (const relation of sourceRelations) {
		const nextSourceMediaId =
			relation.sourceMediaId === source.id ? target.id : relation.sourceMediaId
		const nextTargetMediaId =
			relation.targetMediaId === source.id ? target.id : relation.targetMediaId
		if (
			nextSourceMediaId === nextTargetMediaId ||
			existing.has(
				relationKey({
					...relation,
					sourceMediaId: nextSourceMediaId,
					targetMediaId: nextTargetMediaId,
				}),
			)
		) {
			prune.push(relation)
			continue
		}
		move.push({
			id: relation.id,
			sourceMediaId: relation.sourceMediaId,
			targetMediaId: relation.targetMediaId,
			nextSourceMediaId,
			nextTargetMediaId,
		})
	}
	return { move, prune }
}

async function readMergeContext(
	tx: MergeTransaction,
	input: { issueId: string; targetMediaId: string },
): Promise<MergeContext> {
	const issue = await tx.catalogQualityIssue.findUnique({
		where: { id: input.issueId },
		select: {
			id: true,
			status: true,
			issueType: true,
			evidence: true,
			primaryMediaId: true,
			secondaryMediaId: true,
		},
	})
	if (!issue) throw new Error('Catalog quality issue was not found')
	if (
		(issue.issueType !== 'possible_duplicate' &&
			issue.issueType !== 'cross_kind_duplicate') ||
		!issue.secondaryMediaId
	) {
		throw new Error('Only paired duplicate candidates can be merged')
	}
	if (issue.status !== 'confirmed') {
		throw new Error(
			'Duplicate candidate must be confirmed before merge planning',
		)
	}
	if (!issue.evidence) {
		throw new Error(
			'Duplicate candidate requires fresh provider-scan evidence before merge planning',
		)
	}
	const pair = [issue.primaryMediaId, issue.secondaryMediaId]
	if (!pair.includes(input.targetMediaId)) {
		throw new Error(
			'Merge target must be one of the reviewed duplicate records',
		)
	}
	const sourceMediaId = pair.find(id => id !== input.targetMediaId)
	if (!sourceMediaId)
		throw new Error('Merge source and target must be different')
	const [source, target, activeMerges] = await Promise.all([
		tx.media.findUnique({
			where: { id: sourceMediaId },
			include: mergeMediaInclude,
		}),
		tx.media.findUnique({
			where: { id: input.targetMediaId },
			include: mergeMediaInclude,
		}),
		tx.catalogMediaMerge.findMany({
			where: {
				status: 'applied',
				catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
				OR: [{ sourceMediaId: { in: pair } }, { targetMediaId: { in: pair } }],
			},
			select: { id: true },
		}),
	])
	if (!source || !target) {
		throw new Error('Both duplicate media records must still exist')
	}

	const targetTitles = keyed(target.titles, titleKey)
	const titlePrunes = source.titles.filter(title =>
		targetTitles.has(titleKey(title)),
	)
	const targetFeeds = keyed(target.catalogFeedItems, feedKey)
	const feedPrunes = source.catalogFeedItems.filter(feed =>
		targetFeeds.has(feedKey(feed)),
	)
	const relations = relationPlan(source, target)
	const targetFills: Partial<Record<CatalogMediaField, unknown>> = {}
	const targetConflicts: CatalogMediaField[] = []
	for (const field of catalogMediaFields) {
		if (missingValue(target[field]) && !missingValue(source[field])) {
			targetFills[field] = source[field]
		} else if (
			!missingValue(source[field]) &&
			!missingValue(target[field]) &&
			comparableValue(source[field]) !== comparableValue(target[field])
		) {
			targetConflicts.push(field)
		}
	}

	const crossKind = issue.issueType === 'cross_kind_duplicate'
	const blockers = [
		source.catalogProvenanceVersion === TRUSTED_CATALOG_PROVENANCE_VERSION &&
		target.catalogProvenanceVersion === TRUSTED_CATALOG_PROVENANCE_VERSION
			? null
			: {
					code: 'untrusted-catalog-provenance',
					message:
						'Both media records must pass the catalog provenance repair before merging.',
					count: 1,
					examples: [],
				},
		// Kinds differing is normally the strongest signal that two rows are not
		// the same work, so it stays a hard refusal — except for the one issue
		// type whose entire evidence is a shared provider id, where differing
		// kinds is the point. Even then the direction is fixed rather than left
		// to whichever record the admin happened to pick as the target: anime
		// survives, live action does not.
		crossKind
			? target.kind === 'anime' &&
				(source.kind === 'tv' || source.kind === 'movie')
				? null
				: source.kind === 'anime'
					? {
							// They picked the wrong direction: the anime is the record
							// being absorbed rather than the one being kept.
							code: 'anime-must-survive',
							message: `A cross-kind merge must keep the anime record; ${target.kind} was chosen instead.`,
							count: 1,
							examples: [],
						}
					: {
							code: 'kind-mismatch',
							message: `A cross-kind merge absorbs a live-action record into an anime one, not ${source.kind} into ${target.kind}.`,
							count: 1,
							examples: [],
						}
			: source.kind === target.kind
				? null
				: {
						code: 'kind-mismatch',
						message: `Media kinds differ (${source.kind} and ${target.kind}).`,
						count: 1,
						examples: [source.kind, target.kind],
					},
		activeMerges.length
			? {
					code: 'active-merge',
					message:
						'A selected media record already participates in an applied merge.',
					count: activeMerges.length,
					examples: activeMerges.slice(0, 10).map(merge => merge.id),
				}
			: null,
		collisionBlocker(
			'watchlist-entry-collision',
			'watchlist',
			source.entries.map(row => row.watchlistId),
			target.entries.map(row => row.watchlistId),
		),
		collisionBlocker(
			'favorite-collision',
			'member favorite slot',
			source.favorites.map(row => `${row.ownerId}:${row.typeId}`),
			target.favorites.map(row => `${row.ownerId}:${row.typeId}`),
		),
		collisionBlocker(
			'tracking-state-collision',
			'member tracking state',
			source.trackingStates.map(row => row.ownerId),
			target.trackingStates.map(row => row.ownerId),
		),
		collisionBlocker(
			'media-season-collision',
			'media season',
			source.seasons.map(seasonKey),
			target.seasons.map(seasonKey),
		),
		collisionBlocker(
			'media-installment-collision',
			'media installment',
			source.installments.map(installmentKey),
			target.installments.map(installmentKey),
		),
		collisionBlocker(
			'review-collision',
			'member review',
			source.reviews.map(row => row.authorId),
			target.reviews.map(row => row.authorId),
		),
		collisionBlocker(
			'collection-item-collision',
			'collection',
			source.collectionItems.map(row => row.collectionId),
			target.collectionItems.map(row => row.collectionId),
		),
		collisionBlocker(
			'release-reminder-collision',
			'member release reminder',
			source.releaseReminders.map(row => row.ownerId),
			target.releaseReminders.map(row => row.ownerId),
		),
		collisionBlocker(
			'release-occurrence-collision',
			'release occurrence',
			movableReleaseOccurrences(source).map(releaseOccurrenceKey),
			movableReleaseOccurrences(target).map(releaseOccurrenceKey),
		),
		collisionBlocker(
			'catalog-metric-snapshot-collision',
			'catalog metric snapshot',
			source.catalogMetricSnapshots.map(metricSnapshotKey),
			target.catalogMetricSnapshots.map(metricSnapshotKey),
		),
		collisionBlocker(
			'recommendation-feedback-collision',
			'member recommendation feedback',
			source.recommendationFeedback.map(row => row.ownerId),
			target.recommendationFeedback.map(row => row.ownerId),
		),
		// Both rows describe the same work, so they routinely carry the same
		// offer and the same person. Moving one onto the other would violate the
		// unique constraint mid-transaction; refusing is the honest answer.
		collisionBlocker(
			'watch-availability-collision',
			'streaming offer',
			source.watchAvailability.map(watchAvailabilityKey),
			target.watchAvailability.map(watchAvailabilityKey),
		),
		collisionBlocker(
			'credit-collision',
			'credit',
			source.credits.map(creditKey),
			target.credits.map(creditKey),
		),
	].filter((value): value is MergeBlocker => Boolean(value))

	return {
		issue,
		source,
		target,
		activeMergeIds: activeMerges.map(merge => merge.id),
		titlePrunes,
		feedPrunes,
		relationPlan: relations,
		targetFills,
		targetConflicts,
		blockers,
	}
}

function fingerprintContext(context: MergeContext) {
	const inventory = (media: MergeMedia) => ({
		scalar: serializedMedia(media),
		externalIds: media.externalIds.map(row => row.id).sort(),
		titles: media.titles
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		catalogFeedItems: media.catalogFeedItems
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		relations: uniqueById([
			...media.outgoingRelations,
			...media.incomingRelations,
		])
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		entries: media.entries.map(row => row.id).sort(),
		favorites: media.favorites.map(row => row.id).sort(),
		trackingStates: media.trackingStates.map(row => row.id).sort(),
		seasons: media.seasons
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		installments: media.installments
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		consumptionEvents: media.consumptionEvents.map(row => row.id).sort(),
		activityEvents: media.activityEvents.map(row => row.id).sort(),
		reviews: media.reviews.map(row => row.id).sort(),
		diaryEntries: media.diaryEntries.map(row => row.id).sort(),
		collectionItems: media.collectionItems.map(row => row.id).sort(),
		releaseReminders: media.releaseReminders.map(row => row.id).sort(),
		releaseOccurrences: media.releaseOccurrences
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		catalogMetricSnapshots: media.catalogMetricSnapshots
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		recommendationFeedback: media.recommendationFeedback
			.map(serializedRow)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
		libraryImportItems: media.libraryImportItems.map(row => row.id).sort(),
		qualityIssues: uniqueById([
			...media.primaryQualityIssues,
			...media.secondaryQualityIssues,
		]).sort((left, right) => left.id.localeCompare(right.id)),
	})
	return hash({
		issue: context.issue,
		source: inventory(context.source),
		target: inventory(context.target),
		activeMergeIds: context.activeMergeIds,
	})
}

function preflightFromContext(
	context: MergeContext,
	now: Date,
): CatalogMediaMergePreflight {
	const fingerprint = fingerprintContext(context)
	return {
		issueId: context.issue.id,
		source: {
			id: context.source.id,
			title: context.source.title,
			kind: context.source.kind,
		},
		target: {
			id: context.target.id,
			title: context.target.title,
			kind: context.target.kind,
		},
		safe: context.blockers.length === 0,
		blockers: context.blockers,
		warnings: [
			...(context.targetConflicts.length
				? [
						`The target keeps ${context.targetConflicts.length} conflicting non-empty catalog field${context.targetConflicts.length === 1 ? '' : 's'}: ${context.targetConflicts.join(', ')}.`,
					]
				: []),
			...(context.relationPlan.prune.length
				? [
						`${context.relationPlan.prune.length} self or duplicate catalog relation${context.relationPlan.prune.length === 1 ? '' : 's'} will be journaled and pruned.`,
					]
				: []),
		],
		moves: {
			externalIds: context.source.externalIds.length,
			titles: context.source.titles.length - context.titlePrunes.length,
			catalogFeedItems:
				context.source.catalogFeedItems.length - context.feedPrunes.length,
			relations: context.relationPlan.move.length,
			entries: context.source.entries.length,
			favorites: context.source.favorites.length,
			trackingStates: context.source.trackingStates.length,
			seasons: context.source.seasons.length,
			installments: context.source.installments.length,
			consumptionEvents: context.source.consumptionEvents.length,
			activityEvents: context.source.activityEvents.length,
			reviews: context.source.reviews.length,
			diaryEntries: context.source.diaryEntries.length,
			collectionItems: context.source.collectionItems.length,
			releaseReminders: context.source.releaseReminders.length,
			releaseOccurrences: movableReleaseOccurrences(context.source).length,
			catalogMetricSnapshots: context.source.catalogMetricSnapshots.length,
			recommendationFeedback: context.source.recommendationFeedback.length,
			libraryImportItems: context.source.libraryImportItems.length,
			watchAvailability: context.source.watchAvailability.length,
			credits: context.source.credits.length,
			qualityIssues: uniqueById([
				...context.source.primaryQualityIssues,
				...context.source.secondaryQualityIssues,
			]).length,
		},
		prunes: {
			titles: context.titlePrunes.length,
			catalogFeedItems: context.feedPrunes.length,
			relations: context.relationPlan.prune.length,
		},
		targetFills: Object.keys(context.targetFills) as CatalogMediaField[],
		targetConflicts: context.targetConflicts,
		fingerprint,
		generatedAt: now.toISOString(),
	}
}

export async function buildCatalogMediaMergePreflight(
	prisma: PrismaClient,
	input: { issueId: string; targetMediaId: string; now?: Date },
) {
	return prisma.$transaction(async tx => {
		const context = await readMergeContext(tx, input)
		return preflightFromContext(context, input.now ?? new Date())
	})
}

export async function prepareCatalogMediaMerge(
	prisma: PrismaClient,
	input: {
		issueId: string
		targetMediaId: string
		actorId: string
		now?: Date
	},
) {
	const now = input.now ?? new Date()
	return prisma.$transaction(async tx => {
		const context = await readMergeContext(tx, input)
		const preflight = preflightFromContext(context, now)
		const existing = await tx.catalogMediaMerge.findUnique({
			where: { issueId: input.issueId },
			select: { id: true, status: true },
		})
		if (existing?.status === 'applied') {
			throw new Error('This duplicate issue already has an applied merge')
		}
		if (
			existing &&
			existing.status !== 'planned' &&
			existing.status !== 'reverted' &&
			existing.status !== 'invalidated'
		) {
			throw new Error('This duplicate issue already has a merge in progress')
		}
		const merge = existing
			? await tx.catalogMediaMerge.update({
					where: { id: existing.id },
					data: {
						status: 'planned',
						sourceMediaId: preflight.source.id,
						targetMediaId: preflight.target.id,
						preflight: JSON.stringify(preflight),
						preflightFingerprint: preflight.fingerprint,
						journal: null,
						preparedAt: now,
						appliedAt: null,
						revertedAt: null,
						preparedById: input.actorId,
						appliedById: null,
						revertedById: null,
						catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
					},
				})
			: await tx.catalogMediaMerge.create({
					data: {
						issueId: input.issueId,
						status: 'planned',
						sourceMediaId: preflight.source.id,
						targetMediaId: preflight.target.id,
						preflight: JSON.stringify(preflight),
						preflightFingerprint: preflight.fingerprint,
						preparedAt: now,
						preparedById: input.actorId,
						catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
					},
				})
		await tx.catalogMediaMergeEvent.create({
			data: {
				mergeId: merge.id,
				actorId: input.actorId,
				action: existing ? 'reprepare' : 'prepare',
				previousStatus: existing?.status ?? null,
				nextStatus: 'planned',
				details: JSON.stringify({
					safe: preflight.safe,
					blockers: preflight.blockers.map(blocker => blocker.code),
					fingerprint: preflight.fingerprint,
				}),
			},
		})
		return { merge, preflight }
	}, writeTransactionOptions)
}

function sourceQualityIssues(source: MergeMedia) {
	return uniqueById([
		...source.primaryQualityIssues,
		...source.secondaryQualityIssues,
	])
}

function journalFromContext(context: MergeContext, now: Date): MergeJournal {
	const titlePruneIds = new Set(context.titlePrunes.map(row => row.id))
	const feedPruneIds = new Set(context.feedPrunes.map(row => row.id))
	const targetPrevious = Object.fromEntries(
		Object.keys(context.targetFills).map(field => [
			field,
			serializedValue(context.target[field as CatalogMediaField]),
		]),
	) as MergeJournal['targetPatch']['previous']
	const targetApplied = Object.fromEntries(
		Object.entries(context.targetFills).map(([field, value]) => [
			field,
			serializedValue(value),
		]),
	) as MergeJournal['targetPatch']['applied']
	return {
		version: 1,
		inventoryVersion: 4,
		appliedAt: now.toISOString(),
		sourceMedia: serializedMedia(context.source),
		targetPatch: { previous: targetPrevious, applied: targetApplied },
		moved: {
			externalIds: context.source.externalIds.map(row => row.id),
			titles: context.source.titles
				.filter(row => !titlePruneIds.has(row.id))
				.map(row => row.id),
			catalogFeedItems: context.source.catalogFeedItems
				.filter(row => !feedPruneIds.has(row.id))
				.map(row => row.id),
			entries: context.source.entries.map(row => row.id),
			favorites: context.source.favorites.map(row => row.id),
			trackingStates: context.source.trackingStates.map(row => row.id),
			seasons: context.source.seasons.map(row => row.id),
			installments: context.source.installments.map(row => row.id),
			consumptionEvents: context.source.consumptionEvents.map(row => row.id),
			activityEvents: context.source.activityEvents.map(row => row.id),
			reviews: context.source.reviews.map(row => row.id),
			diaryEntries: context.source.diaryEntries.map(row => row.id),
			collectionItems: context.source.collectionItems.map(row => row.id),
			releaseReminders: context.source.releaseReminders.map(row => row.id),
			releaseOccurrences: movableReleaseOccurrences(context.source).map(
				row => row.id,
			),
			catalogMetricSnapshots: context.source.catalogMetricSnapshots.map(
				row => row.id,
			),
			recommendationFeedback: context.source.recommendationFeedback.map(
				row => row.id,
			),
			libraryImportItems: context.source.libraryImportItems.map(row => row.id),
			watchAvailability: context.source.watchAvailability.map(row => row.id),
			credits: context.source.credits.map(row => row.id),
			tombstonedExternalIds:
				context.issue.issueType === 'cross_kind_duplicate'
					? context.source.externalIds
							.filter(row => row.provider === 'tmdb' && !row.tombstonedAt)
							.map(row => row.id)
					: [],
			relations: context.relationPlan.move,
		},
		pruned: {
			titles: context.titlePrunes,
			catalogFeedItems: context.feedPrunes,
			relations: context.relationPlan.prune,
		},
		qualityIssues: sourceQualityIssues(context.source),
	}
}

async function deletePrunedCatalogRows(
	tx: MergeTransaction,
	context: MergeContext,
) {
	const titleIds = context.titlePrunes.map(row => row.id)
	const feedIds = context.feedPrunes.map(row => row.id)
	const relationIds = context.relationPlan.prune.map(row => row.id)
	if (titleIds.length) {
		await tx.mediaTitle.deleteMany({ where: { id: { in: titleIds } } })
	}
	if (feedIds.length) {
		await tx.catalogFeedItem.deleteMany({ where: { id: { in: feedIds } } })
	}
	if (relationIds.length) {
		await tx.mediaRelation.deleteMany({ where: { id: { in: relationIds } } })
	}
}

/**
 * Stop TMDB hydration claiming a row that anime just won.
 *
 * When a live-action record is absorbed, its real `provider:'tmdb'` identity
 * moves onto the surviving anime record with everything else. That identity is
 * what `eligibleHydrationWhere` selects on, so leaving it active would hand the
 * row to TMDB hydration on its next run and overwrite the MAL-sourced title,
 * description and scores — turning "anime wins" at merge time into "TMDB wins"
 * an hour later. The `tmdb-watch` key exists precisely to keep TMDB off these
 * rows; this keeps that promise through a merge.
 *
 * Tombstoning rather than deleting: the row stays auditable, revert can restore
 * it, and nothing that reads external links filters tombstoned rows, so the
 * TMDB link on the page survives. The anime already carries a `tmdb-watch`
 * identity for the same entry, so streaming lookups are unaffected.
 *
 * Rewriting the provider to `tmdb-watch` instead would collide with that
 * existing row on `@@unique([provider, kind, externalId])`.
 */
async function tombstoneAbsorbedTmdbIdentities(
	tx: MergeTransaction,
	context: MergeContext,
	now: Date,
) {
	if (context.issue.issueType !== 'cross_kind_duplicate') return []
	const absorbed = context.source.externalIds.filter(
		row => row.provider === 'tmdb' && !row.tombstonedAt,
	)
	if (!absorbed.length) return []
	await tx.mediaExternalId.updateMany({
		where: { id: { in: absorbed.map(row => row.id) } },
		data: { tombstonedAt: now },
	})
	return absorbed.map(row => row.id)
}

async function moveRowsToTarget(
	tx: MergeTransaction,
	context: MergeContext,
	now: Date,
) {
	const sourceId = context.source.id
	const targetId = context.target.id
	const move = async (
		model:
			| 'mediaExternalId'
			| 'mediaTitle'
			| 'catalogFeedItem'
			| 'entry'
			| 'userFavorite'
			| 'trackingState'
			| 'mediaSeason'
			| 'mediaInstallment'
			| 'consumptionEvent'
			| 'activityEvent'
			| 'review'
			| 'diaryEntry'
			| 'mediaCollectionItem'
			| 'releaseReminder'
			| 'catalogMetricSnapshot'
			| 'recommendationFeedback'
			| 'libraryImportItem'
			| 'watchAvailability'
			| 'mediaCredit',
	) => {
		await (
			tx[model] as unknown as {
				updateMany(input: {
					where: { mediaId: string }
					data: { mediaId: string }
				}): Promise<unknown>
			}
		).updateMany({
			where: { mediaId: sourceId },
			data: { mediaId: targetId },
		})
	}
	await move('mediaExternalId')
	await tombstoneAbsorbedTmdbIdentities(tx, context, now)
	await move('mediaTitle')
	await move('catalogFeedItem')
	await move('entry')
	await move('userFavorite')
	await move('trackingState')
	await move('mediaSeason')
	await move('mediaInstallment')
	await move('consumptionEvent')
	await move('activityEvent')
	await move('review')
	await move('diaryEntry')
	await move('mediaCollectionItem')
	await move('releaseReminder')
	await move('catalogMetricSnapshot')
	await move('recommendationFeedback')
	await move('libraryImportItem')
	await move('watchAvailability')
	await move('mediaCredit')

	const releaseOccurrenceIds = movableReleaseOccurrences(context.source).map(
		row => row.id,
	)
	if (releaseOccurrenceIds.length) {
		await tx.releaseOccurrence.updateMany({
			where: {
				id: { in: releaseOccurrenceIds },
				mediaId: sourceId,
			},
			data: { mediaId: targetId },
		})
	}
	await tx.releaseOccurrence.deleteMany({
		where: {
			mediaId: sourceId,
			sourceKey: 'next',
			source: { in: [...releaseScheduleSources] },
		},
	})

	for (const relation of context.relationPlan.move) {
		await tx.mediaRelation.update({
			where: { id: relation.id },
			data: {
				sourceMediaId: relation.nextSourceMediaId,
				targetMediaId: relation.nextTargetMediaId,
			},
		})
	}
	for (const issue of sourceQualityIssues(context.source)) {
		const primaryMediaId =
			issue.primaryMediaId === sourceId ? targetId : issue.primaryMediaId
		let secondaryMediaId =
			issue.secondaryMediaId === sourceId ? targetId : issue.secondaryMediaId
		if (secondaryMediaId === primaryMediaId) secondaryMediaId = null
		await tx.catalogQualityIssue.update({
			where: { id: issue.id },
			data: { primaryMediaId, secondaryMediaId },
		})
	}
}

async function assertSourceDrained(
	tx: MergeTransaction,
	sourceMediaId: string,
) {
	const source = await tx.media.findUnique({
		where: { id: sourceMediaId },
		select: {
			_count: {
				select: {
					externalIds: true,
					titles: true,
					outgoingRelations: true,
					incomingRelations: true,
					entries: true,
					favorites: true,
					trackingStates: true,
					seasons: true,
					installments: true,
					consumptionEvents: true,
					activityEvents: true,
					reviews: true,
					diaryEntries: true,
					collectionItems: true,
					releaseReminders: true,
					releaseOccurrences: true,
					catalogFeedItems: true,
					catalogMetricSnapshots: true,
					primaryQualityIssues: true,
					secondaryQualityIssues: true,
					recommendationFeedback: true,
					libraryImportItems: true,
					watchAvailability: true,
					credits: true,
				},
			},
		},
	})
	if (!source) throw new Error('Merge source disappeared before deletion')
	const remaining = Object.entries(source._count).filter(([, count]) => count)
	if (remaining.length) {
		throw new Error(
			`Merge source still owns audited relations: ${remaining.map(([name, count]) => `${name}=${count}`).join(', ')}`,
		)
	}
}

export async function applyCatalogMediaMerge(
	prisma: PrismaClient,
	input: {
		mergeId: string
		actorId: string
		confirmation: string
		now?: Date
	},
) {
	const now = input.now ?? new Date()
	return prisma.$transaction(async tx => {
		const merge = await tx.catalogMediaMerge.findUnique({
			where: { id: input.mergeId },
		})
		if (!merge || merge.status !== 'planned') {
			throw new Error('Catalog merge is not in a planned state')
		}
		if (merge.catalogProvenanceVersion !== TRUSTED_CATALOG_PROVENANCE_VERSION) {
			throw new Error('Catalog merge predates the trusted provenance boundary')
		}
		if (
			input.confirmation !==
			expectedCatalogMergeConfirmation(merge.sourceMediaId, merge.targetMediaId)
		) {
			throw new Error('Catalog merge confirmation phrase does not match')
		}
		const claim = await tx.catalogMediaMerge.updateMany({
			where: { id: merge.id, status: 'planned' },
			data: { status: 'applying' },
		})
		if (claim.count !== 1) throw new Error('Catalog merge is already changing')
		const context = await readMergeContext(tx, {
			issueId: merge.issueId,
			targetMediaId: merge.targetMediaId,
		})
		const preflight = preflightFromContext(context, now)
		if (preflight.fingerprint !== merge.preflightFingerprint) {
			throw new Error('Catalog merge preflight is stale; prepare it again')
		}
		if (!preflight.safe) {
			throw new Error(
				`Catalog merge is blocked: ${preflight.blockers.map(blocker => blocker.code).join(', ')}`,
			)
		}
		const journal = journalFromContext(context, now)
		await deletePrunedCatalogRows(tx, context)
		await moveRowsToTarget(tx, context, now)
		const targetNextRelease = Object.prototype.hasOwnProperty.call(
			context.targetFills,
			'nextRelease',
		)
			? context.targetFills.nextRelease
			: context.target.nextRelease
		await tx.media.update({
			where: { id: context.target.id },
			data: {
				...context.targetFills,
				nextReleaseAt: deriveNextReleaseAt(targetNextRelease),
			} as Prisma.MediaUpdateInput,
		})
		await syncNextReleaseOccurrence(tx, context.target.id, targetNextRelease)
		await assertSourceDrained(tx, context.source.id)
		await tx.media.delete({ where: { id: context.source.id } })
		await tx.catalogQualityIssue.update({
			where: { id: context.issue.id },
			data: {
				status: 'resolved',
				reviewedAt: now,
				resolvedAt: now,
				reviewedById: input.actorId,
			},
		})
		await tx.catalogQualityEvent.create({
			data: {
				issueId: context.issue.id,
				actorId: input.actorId,
				action: 'apply-merge',
				previousStatus: 'confirmed',
				nextStatus: 'resolved',
				details: JSON.stringify({ mergeId: merge.id }),
			},
		})
		const applied = await tx.catalogMediaMerge.update({
			where: { id: merge.id },
			data: {
				status: 'applied',
				journal: JSON.stringify(journal),
				appliedAt: now,
				appliedById: input.actorId,
			},
		})
		await tx.catalogMediaMergeEvent.create({
			data: {
				mergeId: merge.id,
				actorId: input.actorId,
				action: 'apply',
				previousStatus: 'planned',
				nextStatus: 'applied',
				details: JSON.stringify({
					fingerprint: preflight.fingerprint,
					sourceMediaId: context.source.id,
					targetMediaId: context.target.id,
				}),
			},
		})
		return { merge: applied, preflight }
	}, writeTransactionOptions)
}

function parseJournal(value: string | null): MergeJournal {
	if (!value) throw new Error('Applied catalog merge has no reversal journal')
	const parsed = JSON.parse(value) as MergeJournal
	if (parsed.version !== 1) throw new Error('Unsupported merge journal version')
	return parsed
}

function restoredMediaData(snapshot: Record<string, unknown>) {
	const data = { ...snapshot }
	for (const field of [
		'releaseStart',
		'releaseEnd',
		'createdAt',
		'updatedAt',
	]) {
		if (typeof data[field] === 'string') data[field] = new Date(data[field])
	}
	return data as Prisma.MediaUncheckedCreateInput
}

async function assertMovedRowsStillTargeted(
	tx: MergeTransaction,
	journal: MergeJournal,
	targetMediaId: string,
) {
	const groups = [
		['mediaExternalId', journal.moved.externalIds],
		['mediaTitle', journal.moved.titles],
		['catalogFeedItem', journal.moved.catalogFeedItems],
		['entry', journal.moved.entries],
		['userFavorite', journal.moved.favorites],
		['trackingState', journal.moved.trackingStates],
		['mediaSeason', journal.moved.seasons ?? []],
		['mediaInstallment', journal.moved.installments ?? []],
		['consumptionEvent', journal.moved.consumptionEvents ?? []],
		['activityEvent', journal.moved.activityEvents],
		['review', journal.moved.reviews],
		['diaryEntry', journal.moved.diaryEntries],
		['mediaCollectionItem', journal.moved.collectionItems],
		['releaseReminder', journal.moved.releaseReminders],
		['releaseOccurrence', journal.moved.releaseOccurrences ?? []],
		['catalogMetricSnapshot', journal.moved.catalogMetricSnapshots ?? []],
		['recommendationFeedback', journal.moved.recommendationFeedback ?? []],
		['libraryImportItem', journal.moved.libraryImportItems ?? []],
		// Absent from a version-3 journal, where these were never carried.
		['watchAvailability', journal.moved.watchAvailability ?? []],
		['mediaCredit', journal.moved.credits ?? []],
	] as const
	for (const [model, ids] of groups) {
		if (!ids.length) continue
		const count = await (
			tx[model] as unknown as {
				count(input: {
					where: { id: { in: string[] }; mediaId: string }
				}): Promise<number>
			}
		).count({ where: { id: { in: ids }, mediaId: targetMediaId } })
		if (count !== ids.length) {
			throw new Error(
				`Merge reversal is blocked because ${model} rows changed or disappeared`,
			)
		}
	}
	for (const relation of journal.moved.relations) {
		const current = await tx.mediaRelation.findUnique({
			where: { id: relation.id },
			select: { sourceMediaId: true, targetMediaId: true },
		})
		if (
			!current ||
			current.sourceMediaId !== relation.nextSourceMediaId ||
			current.targetMediaId !== relation.nextTargetMediaId
		) {
			throw new Error(
				'Merge reversal is blocked because a media relation changed or disappeared',
			)
		}
	}
}

async function moveJournalRowsBack(
	tx: MergeTransaction,
	journal: MergeJournal,
	sourceMediaId: string,
) {
	const groups = [
		['mediaExternalId', journal.moved.externalIds],
		['mediaTitle', journal.moved.titles],
		['catalogFeedItem', journal.moved.catalogFeedItems],
		['entry', journal.moved.entries],
		['userFavorite', journal.moved.favorites],
		['trackingState', journal.moved.trackingStates],
		['mediaSeason', journal.moved.seasons ?? []],
		['mediaInstallment', journal.moved.installments ?? []],
		['consumptionEvent', journal.moved.consumptionEvents ?? []],
		['activityEvent', journal.moved.activityEvents],
		['review', journal.moved.reviews],
		['diaryEntry', journal.moved.diaryEntries],
		['mediaCollectionItem', journal.moved.collectionItems],
		['releaseReminder', journal.moved.releaseReminders],
		['releaseOccurrence', journal.moved.releaseOccurrences ?? []],
		['catalogMetricSnapshot', journal.moved.catalogMetricSnapshots ?? []],
		['recommendationFeedback', journal.moved.recommendationFeedback ?? []],
		['libraryImportItem', journal.moved.libraryImportItems ?? []],
		// Absent from a version-3 journal, where these were never carried.
		['watchAvailability', journal.moved.watchAvailability ?? []],
		['mediaCredit', journal.moved.credits ?? []],
	] as const
	for (const [model, ids] of groups) {
		if (!ids.length) continue
		await (
			tx[model] as unknown as {
				updateMany(input: {
					where: { id: { in: string[] } }
					data: { mediaId: string }
				}): Promise<unknown>
			}
		).updateMany({
			where: { id: { in: ids } },
			data: { mediaId: sourceMediaId },
		})
	}
	for (const relation of journal.moved.relations) {
		await tx.mediaRelation.update({
			where: { id: relation.id },
			data: {
				sourceMediaId: relation.sourceMediaId,
				targetMediaId: relation.targetMediaId,
			},
		})
	}
}

async function restorePrunedRows(tx: MergeTransaction, journal: MergeJournal) {
	for (const title of journal.pruned.titles) {
		await tx.mediaTitle.create({
			data: {
				...title,
				createdAt: new Date(title.createdAt),
				updatedAt: new Date(title.updatedAt),
			},
		})
	}
	for (const feed of journal.pruned.catalogFeedItems) {
		await tx.catalogFeedItem.create({
			data: {
				...feed,
				observedAt: new Date(feed.observedAt),
			},
		})
	}
	for (const relation of journal.pruned.relations) {
		await tx.mediaRelation.create({
			data: {
				...relation,
				createdAt: new Date(relation.createdAt),
				updatedAt: new Date(relation.updatedAt),
			},
		})
	}
}

export async function revertCatalogMediaMerge(
	prisma: PrismaClient,
	input: {
		mergeId: string
		actorId: string
		confirmation: string
		now?: Date
	},
) {
	const now = input.now ?? new Date()
	return prisma.$transaction(async tx => {
		const merge = await tx.catalogMediaMerge.findUnique({
			where: { id: input.mergeId },
			include: {
				issue: {
					select: {
						status: true,
						events: {
							orderBy: { createdAt: 'desc' },
							take: 1,
							select: { action: true },
						},
					},
				},
			},
		})
		if (!merge || merge.status !== 'applied') {
			throw new Error('Catalog merge is not in an applied state')
		}
		if (merge.catalogProvenanceVersion !== TRUSTED_CATALOG_PROVENANCE_VERSION) {
			throw new Error('Catalog merge predates the trusted provenance boundary')
		}
		if (input.confirmation !== expectedCatalogMergeReversal(merge.id)) {
			throw new Error('Catalog merge reversal phrase does not match')
		}
		if (
			merge.issue.status !== 'resolved' ||
			merge.issue.events[0]?.action !== 'apply-merge'
		) {
			throw new Error(
				'Merge reversal is blocked because the quality review changed after apply',
			)
		}
		const claim = await tx.catalogMediaMerge.updateMany({
			where: { id: merge.id, status: 'applied' },
			data: { status: 'reverting' },
		})
		if (claim.count !== 1) throw new Error('Catalog merge is already changing')
		const journal = parseJournal(merge.journal)
		// 4 added streaming offers and credits. A version-3 journal is still
		// revertible — it restores everything it recorded — but the rows those
		// merges deleted are already gone, which is what the bump records.
		if (journal.inventoryVersion !== 3 && journal.inventoryVersion !== 4) {
			throw new Error(
				'Legacy merge reversal requires a manual relation-integrity audit',
			)
		}
		const [source, target] = await Promise.all([
			tx.media.findUnique({
				where: { id: merge.sourceMediaId },
				select: { id: true },
			}),
			tx.media.findUnique({ where: { id: merge.targetMediaId } }),
		])
		if (source)
			throw new Error('Merge source already exists; reversal is unsafe')
		if (!target) throw new Error('Merge target no longer exists')
		await assertMovedRowsStillTargeted(tx, journal, merge.targetMediaId)
		for (const [field, appliedValue] of Object.entries(
			journal.targetPatch.applied,
		)) {
			if (
				comparableValue(target[field as CatalogMediaField]) !==
				comparableValue(appliedValue)
			) {
				throw new Error(
					`Merge reversal is blocked because target field ${field} changed after apply`,
				)
			}
		}
		const currentQualityIssues = await tx.catalogQualityIssue.findMany({
			where: { id: { in: journal.qualityIssues.map(issue => issue.id) } },
			select: { id: true },
		})
		if (currentQualityIssues.length !== journal.qualityIssues.length) {
			throw new Error(
				'Merge reversal is blocked because a quality finding disappeared',
			)
		}

		const sourceMediaData = restoredMediaData(journal.sourceMedia)
		const targetNextRelease = Object.prototype.hasOwnProperty.call(
			journal.targetPatch.previous,
			'nextRelease',
		)
			? journal.targetPatch.previous.nextRelease
			: target.nextRelease
		await tx.media.create({
			data: {
				...sourceMediaData,
				nextReleaseAt: deriveNextReleaseAt(sourceMediaData.nextRelease),
			},
		})
		await tx.media.update({
			where: { id: merge.targetMediaId },
			data: {
				...journal.targetPatch.previous,
				nextReleaseAt: deriveNextReleaseAt(targetNextRelease),
			} as Prisma.MediaUpdateInput,
		})
		await syncNextReleaseOccurrence(
			tx,
			merge.sourceMediaId,
			sourceMediaData.nextRelease,
		)
		await syncNextReleaseOccurrence(tx, merge.targetMediaId, targetNextRelease)
		await moveJournalRowsBack(tx, journal, merge.sourceMediaId)
		// Undo the tombstone too, or a reverted cross-kind merge leaves the
		// live-action record back in place but invisible to TMDB hydration.
		const tombstoned = journal.moved.tombstonedExternalIds ?? []
		if (tombstoned.length) {
			await tx.mediaExternalId.updateMany({
				where: { id: { in: tombstoned } },
				data: { tombstonedAt: null },
			})
		}
		await restorePrunedRows(tx, journal)
		for (const issue of journal.qualityIssues) {
			await tx.catalogQualityIssue.update({
				where: { id: issue.id },
				data: {
					primaryMediaId: issue.primaryMediaId,
					secondaryMediaId: issue.secondaryMediaId,
				},
			})
		}
		await tx.catalogQualityIssue.update({
			where: { id: merge.issueId },
			data: {
				status: 'confirmed',
				reviewedAt: now,
				resolvedAt: null,
				reviewedById: input.actorId,
			},
		})
		await tx.catalogQualityEvent.create({
			data: {
				issueId: merge.issueId,
				actorId: input.actorId,
				action: 'revert-merge',
				previousStatus: 'resolved',
				nextStatus: 'confirmed',
				details: JSON.stringify({ mergeId: merge.id }),
			},
		})
		const reverted = await tx.catalogMediaMerge.update({
			where: { id: merge.id },
			data: {
				status: 'reverted',
				revertedAt: now,
				revertedById: input.actorId,
			},
		})
		await tx.catalogMediaMergeEvent.create({
			data: {
				mergeId: merge.id,
				actorId: input.actorId,
				action: 'revert',
				previousStatus: 'applied',
				nextStatus: 'reverted',
				details: JSON.stringify({
					sourceMediaId: merge.sourceMediaId,
					targetMediaId: merge.targetMediaId,
				}),
			},
		})
		return reverted
	}, writeTransactionOptions)
}

export async function getCatalogMediaMergeForIssue(
	prisma: PrismaClient,
	issueId: string,
) {
	return prisma.catalogMediaMerge.findUnique({
		where: { issueId },
		include: {
			preparedBy: { select: { username: true } },
			appliedBy: { select: { username: true } },
			revertedBy: { select: { username: true } },
			events: {
				orderBy: { createdAt: 'desc' },
				take: 10,
				include: { actor: { select: { username: true } } },
			},
		},
	})
}
