import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
	catalogMediaFields,
	expectedCatalogMergeConfirmation,
	expectedCatalogMergeReversal,
	type CatalogMediaField,
	type CatalogMediaMergePreflight,
} from './catalog-media-merge.ts'

const mergeMediaInclude = {
	externalIds: { select: { id: true } },
	titles: true,
	catalogFeedItems: true,
	outgoingRelations: true,
	incomingRelations: true,
	entries: { select: { id: true, watchlistId: true } },
	favorites: { select: { id: true, ownerId: true, typeId: true } },
	trackingStates: { select: { id: true, ownerId: true } },
	activityEvents: { select: { id: true } },
	reviews: { select: { id: true, authorId: true } },
	diaryEntries: { select: { id: true } },
	collectionItems: { select: { id: true, collectionId: true } },
	releaseReminders: { select: { id: true, ownerId: true } },
	primaryQualityIssues: {
		select: { id: true, primaryMediaId: true, secondaryMediaId: true },
	},
	secondaryQualityIssues: {
		select: { id: true, primaryMediaId: true, secondaryMediaId: true },
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
		activityEvents: string[]
		reviews: string[]
		diaryEntries: string[]
		collectionItems: string[]
		releaseReminders: string[]
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
			primaryMediaId: true,
			secondaryMediaId: true,
		},
	})
	if (!issue) throw new Error('Catalog quality issue was not found')
	if (issue.issueType !== 'possible_duplicate' || !issue.secondaryMediaId) {
		throw new Error('Only paired duplicate candidates can be merged')
	}
	if (issue.status !== 'confirmed') {
		throw new Error(
			'Duplicate candidate must be confirmed before merge planning',
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

	const blockers = [
		source.kind === target.kind
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
		activityEvents: media.activityEvents.map(row => row.id).sort(),
		reviews: media.reviews.map(row => row.id).sort(),
		diaryEntries: media.diaryEntries.map(row => row.id).sort(),
		collectionItems: media.collectionItems.map(row => row.id).sort(),
		releaseReminders: media.releaseReminders.map(row => row.id).sort(),
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
			activityEvents: context.source.activityEvents.length,
			reviews: context.source.reviews.length,
			diaryEntries: context.source.diaryEntries.length,
			collectionItems: context.source.collectionItems.length,
			releaseReminders: context.source.releaseReminders.length,
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
			existing.status !== 'reverted'
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
			activityEvents: context.source.activityEvents.map(row => row.id),
			reviews: context.source.reviews.map(row => row.id),
			diaryEntries: context.source.diaryEntries.map(row => row.id),
			collectionItems: context.source.collectionItems.map(row => row.id),
			releaseReminders: context.source.releaseReminders.map(row => row.id),
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

async function moveRowsToTarget(tx: MergeTransaction, context: MergeContext) {
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
			| 'activityEvent'
			| 'review'
			| 'diaryEntry'
			| 'mediaCollectionItem'
			| 'releaseReminder',
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
	await move('mediaTitle')
	await move('catalogFeedItem')
	await move('entry')
	await move('userFavorite')
	await move('trackingState')
	await move('activityEvent')
	await move('review')
	await move('diaryEntry')
	await move('mediaCollectionItem')
	await move('releaseReminder')

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
					activityEvents: true,
					reviews: true,
					diaryEntries: true,
					collectionItems: true,
					releaseReminders: true,
					catalogFeedItems: true,
					primaryQualityIssues: true,
					secondaryQualityIssues: true,
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
		await moveRowsToTarget(tx, context)
		if (Object.keys(context.targetFills).length) {
			await tx.media.update({
				where: { id: context.target.id },
				data: context.targetFills as Prisma.MediaUpdateInput,
			})
		}
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
		['activityEvent', journal.moved.activityEvents],
		['review', journal.moved.reviews],
		['diaryEntry', journal.moved.diaryEntries],
		['mediaCollectionItem', journal.moved.collectionItems],
		['releaseReminder', journal.moved.releaseReminders],
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
		['activityEvent', journal.moved.activityEvents],
		['review', journal.moved.reviews],
		['diaryEntry', journal.moved.diaryEntries],
		['mediaCollectionItem', journal.moved.collectionItems],
		['releaseReminder', journal.moved.releaseReminders],
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

		await tx.media.create({ data: restoredMediaData(journal.sourceMedia) })
		if (Object.keys(journal.targetPatch.previous).length) {
			await tx.media.update({
				where: { id: merge.targetMediaId },
				data: journal.targetPatch.previous as Prisma.MediaUpdateInput,
			})
		}
		await moveJournalRowsBack(tx, journal, merge.sourceMediaId)
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
