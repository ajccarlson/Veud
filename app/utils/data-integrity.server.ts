import { type PrismaClient } from '@prisma/client'

export type DataIntegritySeverity = 'error' | 'warning'

export type DataIntegrityFinding = {
	code:
		| 'ENTRY_TRACKING_OWNER_MISMATCH'
		| 'ENTRY_TRACKING_MEDIA_MISMATCH'
		| 'TRACKING_STATUS_OWNER_MISMATCH'
		| 'PERSONAL_SCORE_NOT_NORMALIZED'
		| 'PERSONAL_SCORE_CONFLICT'
		| 'ENTRY_WITHOUT_MEDIA'
		| 'TRACKING_STATE_WITHOUT_ENTRY'
	severity: DataIntegritySeverity
	count: number
	samples: Array<{
		id: string
		title: string | null
		detail: string
	}>
}

function numericScore(value: unknown) {
	if (value === null || value === undefined) return null
	const number = Number(value)
	return Number.isFinite(number) && number !== 0 ? number : null
}

function scoreMatches(left: unknown, right: unknown) {
	const leftScore = numericScore(left)
	const rightScore = numericScore(right)
	if (leftScore === null || rightScore === null) return leftScore === rightScore
	return Math.abs(leftScore - rightScore) < 0.000_001
}

export async function auditDataIntegrity(prisma: PrismaClient) {
	const [entries, trackingStates] = await Promise.all([
		prisma.entry.findMany({
			select: {
				id: true,
				title: true,
				personal: true,
				tmdbScore: true,
				malScore: true,
				mediaId: true,
				trackingStateId: true,
				watchlist: {
					select: {
						ownerId: true,
						type: { select: { name: true } },
					},
				},
				media: {
					select: {
						kind: true,
						tmdbScore: true,
						malScore: true,
					},
				},
				trackingState: {
					select: {
						ownerId: true,
						mediaId: true,
						score: true,
						statusWatchlist: { select: { ownerId: true } },
					},
				},
			},
		}),
		prisma.trackingState.findMany({
			select: {
				id: true,
				ownerId: true,
				mediaId: true,
				statusWatchlist: { select: { ownerId: true } },
				_count: { select: { entries: true } },
			},
		}),
	])

	const findingMap = new Map<
		DataIntegrityFinding['code'],
		DataIntegrityFinding
	>()
	const record = (
		code: DataIntegrityFinding['code'],
		severity: DataIntegritySeverity,
		sample: DataIntegrityFinding['samples'][number],
	) => {
		const finding = findingMap.get(code) ?? {
			code,
			severity,
			count: 0,
			samples: [],
		}
		finding.count++
		if (finding.samples.length < 5) finding.samples.push(sample)
		findingMap.set(code, finding)
	}

	let entriesWithPositivePersonalScore = 0
	let entriesWithNormalizedScore = 0
	let entriesWithTmdbScore = 0
	let entriesWithMalScore = 0
	let legacyZeroPersonalScores = 0

	for (const entry of entries) {
		const personal = numericScore(entry.personal)
		const normalized = numericScore(entry.trackingState?.score)
		if (personal !== null) entriesWithPositivePersonalScore++
		if (normalized !== null) entriesWithNormalizedScore++
		if (entry.personal !== null && Number(entry.personal) === 0) {
			legacyZeroPersonalScores++
		}
		if (
			numericScore(entry.media?.tmdbScore) !== null ||
			numericScore(entry.tmdbScore) !== null
		) {
			entriesWithTmdbScore++
		}
		if (
			numericScore(entry.media?.malScore) !== null ||
			numericScore(entry.malScore) !== null
		) {
			entriesWithMalScore++
		}

		if ((!entry.mediaId || !entry.media) && entry.title.trim()) {
			record('ENTRY_WITHOUT_MEDIA', 'warning', {
				id: entry.id,
				title: entry.title,
				detail: 'Entry is not linked to canonical Media.',
			})
		}
		if (personal !== null && normalized === null) {
			record('PERSONAL_SCORE_NOT_NORMALIZED', 'error', {
				id: entry.id,
				title: entry.title,
				detail: `Legacy personal score ${personal} has no normalized tracking score.`,
			})
		}
		if (
			personal !== null &&
			normalized !== null &&
			!scoreMatches(personal, normalized)
		) {
			record('PERSONAL_SCORE_CONFLICT', 'warning', {
				id: entry.id,
				title: entry.title,
				detail: `Entry score ${personal} differs from TrackingState score ${normalized}.`,
			})
		}
		if (
			entry.trackingState &&
			entry.trackingState.ownerId !== entry.watchlist.ownerId
		) {
			record('ENTRY_TRACKING_OWNER_MISMATCH', 'error', {
				id: entry.id,
				title: entry.title,
				detail: 'Entry owner differs from its TrackingState owner.',
			})
		}
		if (
			entry.trackingState &&
			entry.mediaId !== entry.trackingState.mediaId
		) {
			record('ENTRY_TRACKING_MEDIA_MISMATCH', 'error', {
				id: entry.id,
				title: entry.title,
				detail: 'Entry media differs from its TrackingState media.',
			})
		}
		if (
			entry.trackingState?.statusWatchlist &&
			entry.trackingState.statusWatchlist.ownerId !==
				entry.trackingState.ownerId
		) {
			record('TRACKING_STATUS_OWNER_MISMATCH', 'error', {
				id: entry.id,
				title: entry.title,
				detail: 'TrackingState destination list belongs to another owner.',
			})
		}
	}

	for (const state of trackingStates) {
		if (state._count.entries === 0) {
			record('TRACKING_STATE_WITHOUT_ENTRY', 'warning', {
				id: state.id,
				title: null,
				detail: `TrackingState for media ${state.mediaId} has no list entry.`,
			})
		}
		if (
			state.statusWatchlist &&
			state.statusWatchlist.ownerId !== state.ownerId
		) {
			record('TRACKING_STATUS_OWNER_MISMATCH', 'error', {
				id: state.id,
				title: null,
				detail: 'TrackingState destination list belongs to another owner.',
			})
		}
	}

	const findings = [...findingMap.values()].sort(
		(left, right) =>
			(left.severity === right.severity
				? 0
				: left.severity === 'error'
					? -1
					: 1) || left.code.localeCompare(right.code),
	)
	const errorCount = findings
		.filter(finding => finding.severity === 'error')
		.reduce((total, finding) => total + finding.count, 0)
	const warningCount = findings
		.filter(finding => finding.severity === 'warning')
		.reduce((total, finding) => total + finding.count, 0)

	return {
		generatedAt: new Date().toISOString(),
		healthy: errorCount === 0,
		errorCount,
		warningCount,
		summary: {
			entries: entries.length,
			trackingStates: trackingStates.length,
			entriesWithPositivePersonalScore,
			entriesWithNormalizedScore,
			entriesWithTmdbScore,
			entriesWithMalScore,
			legacyZeroPersonalScores,
		},
		findings,
	}
}
