import { expect, test } from 'vitest'
import { auditDataIntegrity } from './data-integrity.server.ts'
import { prisma } from './db.server.ts'

async function fixture(suffix: string) {
	const [owner, other] = await Promise.all([
		prisma.user.create({
			data: {
				email: `integrity-owner-${suffix}@example.com`,
				username: `integrity-owner-${suffix}`,
			},
		}),
		prisma.user.create({
			data: {
				email: `integrity-other-${suffix}@example.com`,
				username: `integrity-other-${suffix}`,
			},
		}),
	])
	const listType = await prisma.listType.create({
		data: {
			name: `integrity-${suffix}`,
			header: 'Integrity',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'tv', title: `Integrity media ${suffix}`, tmdbScore: 8.1 },
	})
	return { owner, other, watchlist, media }
}

test('reports a healthy normalized entry without leaking Decimal values', async () => {
	const data = await fixture('healthy')
	const state = await prisma.trackingState.create({
		data: {
			ownerId: data.owner.id,
			mediaId: data.media.id,
			status: 'watching',
			statusWatchlistId: data.watchlist.id,
			score: 7.5,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: data.watchlist.id,
			mediaId: data.media.id,
			trackingStateId: state.id,
			title: 'Healthy entry',
			position: 1,
			personal: 7.5,
		},
	})
	await prisma.entry.create({
		data: {
			watchlistId: data.watchlist.id,
			title: ' ',
			position: 2,
			personal: 0,
		},
	})

	const report = await auditDataIntegrity(prisma)

	expect(report.healthy).toBe(true)
	expect(report.errorCount).toBe(0)
	expect(report.summary).toEqual(
		expect.objectContaining({
			entries: 2,
			trackingStates: 1,
			entriesWithPositivePersonalScore: 1,
			entriesWithNormalizedScore: 1,
			entriesWithTmdbScore: 1,
		}),
	)
	expect(JSON.parse(JSON.stringify(report))).toEqual(report)
})

test('detects owner, media, normalization, and orphan-state violations', async () => {
	const data = await fixture('broken')
	const otherMedia = await prisma.media.create({
		data: { kind: 'tv', title: 'Other integrity media' },
	})
	const mismatchedState = await prisma.trackingState.create({
		data: {
			ownerId: data.other.id,
			mediaId: otherMedia.id,
			status: 'watching',
			statusWatchlistId: data.watchlist.id,
			score: 4,
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: data.watchlist.id,
				mediaId: data.media.id,
				trackingStateId: mismatchedState.id,
				title: 'Cross-linked entry',
				position: 1,
				personal: 8,
			},
			{
				watchlistId: data.watchlist.id,
				title: 'Unnormalized entry',
				position: 2,
				personal: 6,
			},
		],
	})
	await prisma.trackingState.create({
		data: {
			ownerId: data.owner.id,
			mediaId: data.media.id,
			status: 'watching',
		},
	})

	const report = await auditDataIntegrity(prisma)
	const counts = Object.fromEntries(
		report.findings.map(finding => [finding.code, finding.count]),
	)

	expect(report.healthy).toBe(false)
	expect(counts).toEqual(
		expect.objectContaining({
			ENTRY_TRACKING_OWNER_MISMATCH: 1,
			ENTRY_TRACKING_MEDIA_MISMATCH: 1,
			TRACKING_STATUS_OWNER_MISMATCH: 2,
			PERSONAL_SCORE_NOT_NORMALIZED: 1,
			PERSONAL_SCORE_CONFLICT: 1,
			ENTRY_WITHOUT_MEDIA: 1,
			TRACKING_STATE_WITHOUT_ENTRY: 1,
		}),
	)
})
