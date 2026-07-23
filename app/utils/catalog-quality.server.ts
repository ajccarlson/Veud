import { createHash } from 'node:crypto'
import { type Prisma, type PrismaClient } from '@prisma/client'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'

const MAX_SCAN_LIMIT = 2_000
const MAX_REVIEW_NOTE_LENGTH = 500
const REPAIR_PRIORITY = 50_000

export const catalogQualityIssueTypes = [
	'possible_duplicate',
	'title_conflict',
	'missing_image',
	'invalid_image',
] as const

export const catalogQualityActions = [
	'confirm',
	'dismiss',
	'resolve',
	'reopen',
	'queue-repair',
] as const

export type CatalogQualityIssueType = (typeof catalogQualityIssueTypes)[number]
export type CatalogQualityAction = (typeof catalogQualityActions)[number]

type CatalogQualityMedia = Prisma.MediaGetPayload<{
	include: {
		externalIds: {
			select: {
				id: true
				provider: true
				kind: true
				externalId: true
				sourceTitle: true
				lastFetchedAt: true
				tombstonedAt: true
			}
		}
		titles: {
			select: {
				provider: true
				value: true
				normalized: true
				isPrimary: true
			}
		}
	}
}>

export type CatalogQualityFinding = {
	fingerprint: string
	issueType: CatalogQualityIssueType
	severity: 'info' | 'warning'
	confidence: number | null
	summary: string
	evidence: string
	primaryMediaId: string
	secondaryMediaId: string | null
}

function boundedLimit(value: number) {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SCAN_LIMIT) {
		throw new Error(`limit must be between 1 and ${MAX_SCAN_LIMIT}`)
	}
	return value
}

function fingerprint(
	issueType: CatalogQualityIssueType,
	...parts: Array<string | null>
) {
	return createHash('sha256')
		.update(JSON.stringify([issueType, ...parts]))
		.digest('hex')
}

function mediaYear(media: CatalogQualityMedia) {
	if (media.releaseStart) return media.releaseStart.getUTCFullYear()
	for (const value of [media.airYear, media.startYear, media.startSeason]) {
		const match = value?.match(/\b(18|19|20|21)\d{2}\b/)
		if (match) return Number(match[0])
	}
	return null
}

function mediaLabel(media: CatalogQualityMedia) {
	return media.title?.trim() || `Untitled ${media.kind} (${media.id})`
}

function providerIdentities(media: CatalogQualityMedia) {
	return media.externalIds
		.filter(source => !source.tombstonedAt)
		.map(source => ({
			provider: source.provider,
			kind: source.kind,
			externalId: source.externalId,
		}))
}

function evidence(value: unknown) {
	return JSON.stringify(value)
}

function duplicateFindings(mediaRows: CatalogQualityMedia[]) {
	const groups = new Map<string, CatalogQualityMedia[]>()
	for (const media of mediaRows) {
		const year = mediaYear(media)
		if (!year) continue
		const primaryTitles = new Set(
			media.titles
				.filter(title => title.isPrimary && title.normalized)
				.map(title => title.normalized),
		)
		const canonical = normalizeCatalogTitle(media.title ?? '')
		if (canonical) primaryTitles.add(canonical)
		for (const normalized of primaryTitles) {
			const key = JSON.stringify([media.kind, year, normalized])
			const group = groups.get(key) ?? []
			group.push(media)
			groups.set(key, group)
		}
	}

	const findings: CatalogQualityFinding[] = []
	const seenPairs = new Set<string>()
	for (const [key, group] of groups) {
		const unique = [...new Map(group.map(media => [media.id, media])).values()]
			.sort((left, right) => left.id.localeCompare(right.id))
			.slice(0, 6)
		for (let leftIndex = 0; leftIndex < unique.length; leftIndex++) {
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < unique.length;
				rightIndex++
			) {
				const primary = unique[leftIndex]
				const secondary = unique[rightIndex]
				if (!primary || !secondary) continue
				const pair = `${primary.id}:${secondary.id}`
				if (seenPairs.has(pair)) continue
				seenPairs.add(pair)
				const [, year, normalized] = JSON.parse(key) as [string, number, string]
				findings.push({
					fingerprint: fingerprint(
						'possible_duplicate',
						primary.id,
						secondary.id,
						String(year),
						normalized,
					),
					issueType: 'possible_duplicate',
					severity: 'warning',
					confidence: 0.9,
					summary: `${mediaLabel(primary)} and ${mediaLabel(secondary)} share an exact primary title and ${year} release year.`,
					evidence: evidence({
						reasons: ['exact-primary-title', 'same-kind', 'same-release-year'],
						normalizedTitle: normalized,
						releaseYear: year,
						primary: {
							id: primary.id,
							kind: primary.kind,
							title: primary.title,
							sources: providerIdentities(primary),
						},
						secondary: {
							id: secondary.id,
							kind: secondary.kind,
							title: secondary.title,
							sources: providerIdentities(secondary),
						},
					}),
					primaryMediaId: primary.id,
					secondaryMediaId: secondary.id,
				})
			}
		}
	}
	return findings
}

function singleMediaFindings(media: CatalogQualityMedia) {
	const findings: CatalogQualityFinding[] = []
	const hydratedSources = media.externalIds.filter(
		source => !source.tombstonedAt && source.lastFetchedAt,
	)
	if (!hydratedSources.length) return findings

	const knownTitles = new Set(
		media.titles.map(title => title.normalized).filter(Boolean),
	)
	const missingSourceTitles = hydratedSources
		.map(source => source.sourceTitle?.trim() ?? '')
		.filter(Boolean)
		.filter(title => !knownTitles.has(normalizeCatalogTitle(title)))
	if (missingSourceTitles.length) {
		findings.push({
			fingerprint: fingerprint('title_conflict', media.id),
			issueType: 'title_conflict',
			severity: 'warning',
			confidence: 0.8,
			summary: `${mediaLabel(media)} has hydrated provider titles that are absent from its searchable title provenance.`,
			evidence: evidence({
				mediaId: media.id,
				canonicalTitle: media.title,
				missingSourceTitles: [...new Set(missingSourceTitles)],
				sources: providerIdentities(media),
			}),
			primaryMediaId: media.id,
			secondaryMediaId: null,
		})
	}

	if (!media.thumbnail?.trim()) {
		findings.push({
			fingerprint: fingerprint('missing_image', media.id),
			issueType: 'missing_image',
			severity: 'info',
			confidence: 1,
			summary: `${mediaLabel(media)} is hydrated but has no poster image.`,
			evidence: evidence({
				mediaId: media.id,
				title: media.title,
				sources: providerIdentities(media),
			}),
			primaryMediaId: media.id,
			secondaryMediaId: null,
		})
	} else {
		const imageUrl = media.thumbnail.split('|', 1)[0]?.trim() ?? ''
		let validImage = false
		try {
			const parsed = new URL(imageUrl)
			validImage = parsed.protocol === 'https:'
		} catch {
			validImage = false
		}
		if (!validImage) {
			findings.push({
				fingerprint: fingerprint('invalid_image', media.id),
				issueType: 'invalid_image',
				severity: 'warning',
				confidence: 1,
				summary: `${mediaLabel(media)} has a malformed or non-HTTPS poster URL.`,
				evidence: evidence({
					mediaId: media.id,
					title: media.title,
					imageUrl,
					sources: providerIdentities(media),
				}),
				primaryMediaId: media.id,
				secondaryMediaId: null,
			})
		}
	}
	return findings
}

export function detectCatalogQualityFindings(mediaRows: CatalogQualityMedia[]) {
	const findings = [
		...duplicateFindings(mediaRows),
		...mediaRows.flatMap(singleMediaFindings),
	]
	return [
		...new Map(
			findings.map(finding => [finding.fingerprint, finding]),
		).values(),
	]
}

export async function scanCatalogQuality(
	prisma: PrismaClient,
	{
		limit = 500,
		commit = false,
		now = new Date(),
		afterMediaId,
	}: {
		limit?: number
		commit?: boolean
		now?: Date
		afterMediaId?: string
	} = {},
) {
	const take = boundedLimit(limit)
	const seedMedia = await prisma.media.findMany({
		where: {
			...(afterMediaId ? { id: { gt: afterMediaId } } : {}),
			externalIds: {
				some: { tombstonedAt: null, lastFetchedAt: { not: null } },
			},
		},
		orderBy: { id: 'asc' },
		take,
		include: {
			externalIds: {
				select: {
					id: true,
					provider: true,
					kind: true,
					externalId: true,
					sourceTitle: true,
					lastFetchedAt: true,
					tombstonedAt: true,
				},
			},
			titles: {
				select: {
					provider: true,
					value: true,
					normalized: true,
					isPrimary: true,
				},
			},
		},
	})
	const normalizedTitles = [
		...new Set(
			seedMedia.flatMap(media => [
				normalizeCatalogTitle(media.title ?? ''),
				...media.titles
					.filter(title => title.isPrimary)
					.map(title => title.normalized),
			]),
		),
	].filter(Boolean)
	const matchingTitles = normalizedTitles.length
		? await prisma.mediaTitle.findMany({
				where: {
					isPrimary: true,
					normalized: { in: normalizedTitles },
				},
				select: { mediaId: true },
				take: take * 8,
			})
		: []
	const matchingIds = [
		...new Set(
			matchingTitles
				.map(title => title.mediaId)
				.filter(id => !seedMedia.some(media => media.id === id)),
		),
	].slice(0, take * 2)
	const matchingMedia = matchingIds.length
		? await prisma.media.findMany({
				where: { id: { in: matchingIds } },
				include: {
					externalIds: {
						select: {
							id: true,
							provider: true,
							kind: true,
							externalId: true,
							sourceTitle: true,
							lastFetchedAt: true,
							tombstonedAt: true,
						},
					},
					titles: {
						select: {
							provider: true,
							value: true,
							normalized: true,
							isPrimary: true,
						},
					},
				},
			})
		: []
	const mediaRows = [
		...new Map(
			[...seedMedia, ...matchingMedia].map(media => [media.id, media]),
		).values(),
	]
	const findings = detectCatalogQualityFindings(mediaRows)

	if (commit) {
		await prisma.$transaction(
			findings.map(finding =>
				prisma.catalogQualityIssue.upsert({
					where: { fingerprint: finding.fingerprint },
					create: {
						...finding,
						detectedAt: now,
						lastSeenAt: now,
					},
					update: {
						severity: finding.severity,
						confidence: finding.confidence,
						summary: finding.summary,
						evidence: finding.evidence,
						lastSeenAt: now,
					},
				}),
			),
		)
	}

	return {
		dryRun: !commit,
		scanned: seedMedia.length,
		compared: mediaRows.length,
		complete: seedMedia.length < take,
		nextCursor: seedMedia.at(-1)?.id ?? afterMediaId ?? null,
		findings,
	}
}

function reviewNote(value: string | null | undefined) {
	const note = value?.trim() || null
	if (note && note.length > MAX_REVIEW_NOTE_LENGTH) {
		throw new Error(`note cannot exceed ${MAX_REVIEW_NOTE_LENGTH} characters`)
	}
	return note
}

const actionStatus: Record<CatalogQualityAction, string> = {
	confirm: 'confirmed',
	dismiss: 'dismissed',
	resolve: 'resolved',
	reopen: 'open',
	'queue-repair': 'queued',
}

const allowedPreviousStatuses: Record<CatalogQualityAction, string[]> = {
	confirm: ['open'],
	'queue-repair': ['open'],
	resolve: ['open', 'queued', 'confirmed'],
	dismiss: ['open', 'queued', 'confirmed'],
	reopen: ['queued', 'confirmed', 'resolved', 'dismissed'],
}

export async function transitionCatalogQualityIssue(
	prisma: PrismaClient,
	input: {
		issueId: string
		action: CatalogQualityAction
		actorId: string
		note?: string | null
		now?: Date
	},
) {
	if (!catalogQualityActions.includes(input.action)) {
		throw new Error('Unsupported catalog quality action')
	}
	const note = reviewNote(input.note)
	const now = input.now ?? new Date()
	return prisma.$transaction(async tx => {
		const issue = await tx.catalogQualityIssue.findUnique({
			where: { id: input.issueId },
			include: {
				primaryMedia: {
					select: {
						externalIds: {
							where: { tombstonedAt: null },
							select: { id: true },
						},
					},
				},
				secondaryMedia: {
					select: {
						externalIds: {
							where: { tombstonedAt: null },
							select: { id: true },
						},
					},
				},
			},
		})
		if (!issue) throw new Error('Catalog quality issue was not found')
		if (
			input.action === 'confirm' &&
			issue.issueType !== 'possible_duplicate'
		) {
			throw new Error('Only duplicate candidates can be confirmed')
		}
		if (
			input.action === 'queue-repair' &&
			!['title_conflict', 'missing_image', 'invalid_image'].includes(
				issue.issueType,
			)
		) {
			throw new Error('This issue type cannot queue provider repair')
		}
		const nextStatus = actionStatus[input.action]
		if (!allowedPreviousStatuses[input.action].includes(issue.status)) {
			throw new Error(
				`Cannot ${input.action} a catalog quality issue from ${issue.status}`,
			)
		}

		let queuedSources = 0
		if (input.action === 'queue-repair') {
			const sourceIds = [
				...issue.primaryMedia.externalIds,
				...(issue.secondaryMedia?.externalIds ?? []),
			].map(source => source.id)
			if (!sourceIds.length) {
				throw new Error('No active provider identity is available for repair')
			}
			const result = await tx.mediaExternalId.updateMany({
				where: { id: { in: sourceIds } },
				data: {
					fetchStatus: 'pending',
					refreshAfter: now,
					hydrationPriority: REPAIR_PRIORITY,
					hydrationReason: 'catalog-quality-repair',
					hydrationRequestedAt: now,
				},
			})
			queuedSources = result.count
		}

		const updated = await tx.catalogQualityIssue.update({
			where: { id: issue.id },
			data: {
				status: nextStatus,
				reviewedAt: now,
				reviewedById: input.actorId,
				resolvedAt: ['dismissed', 'resolved'].includes(nextStatus) ? now : null,
			},
		})
		await tx.catalogQualityEvent.create({
			data: {
				issueId: issue.id,
				actorId: input.actorId,
				action: input.action,
				previousStatus: issue.status,
				nextStatus,
				note,
				details: evidence({ queuedSources }),
			},
		})
		return { issue: updated, queuedSources }
	})
}

export async function getCatalogQualitySnapshot(
	prisma: PrismaClient,
	{ issueLimit = 40 } = {},
) {
	const limit = boundedLimit(issueLimit)
	const issueInclude = {
		primaryMedia: {
			select: {
				id: true,
				kind: true,
				title: true,
				releaseStart: true,
				thumbnail: true,
				externalIds: {
					where: { tombstonedAt: null },
					select: {
						provider: true,
						kind: true,
						externalId: true,
					},
				},
			},
		},
		secondaryMedia: {
			select: {
				id: true,
				kind: true,
				title: true,
				releaseStart: true,
				thumbnail: true,
				externalIds: {
					where: { tombstonedAt: null },
					select: {
						provider: true,
						kind: true,
						externalId: true,
					},
				},
			},
		},
		reviewedBy: { select: { id: true, username: true } },
		events: {
			orderBy: { createdAt: 'desc' },
			take: 5,
			include: { actor: { select: { username: true } } },
		},
	} satisfies Prisma.CatalogQualityIssueInclude
	const [counts, activeIssues] = await Promise.all([
		prisma.catalogQualityIssue.groupBy({
			by: ['status', 'issueType'],
			_count: { _all: true },
		}),
		prisma.catalogQualityIssue.findMany({
			where: { status: { in: ['open', 'queued', 'confirmed'] } },
			orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
			take: limit,
			include: issueInclude,
		}),
	])
	const remaining = Math.max(0, limit - activeIssues.length)
	const reviewedIssues = remaining
		? await prisma.catalogQualityIssue.findMany({
				where: { status: { notIn: ['open', 'queued', 'confirmed'] } },
				orderBy: [{ reviewedAt: 'desc' }, { id: 'asc' }],
				take: remaining,
				include: issueInclude,
			})
		: []
	return {
		counts: counts.map(row => ({
			status: row.status,
			issueType: row.issueType,
			count: row._count._all,
		})),
		issues: [...activeIssues, ...reviewedIssues],
	}
}
