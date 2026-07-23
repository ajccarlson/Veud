import { expect, test } from 'vitest'
import {
	detectCatalogQualityFindings,
	getCatalogQualitySnapshot,
	scanCatalogQuality,
	transitionCatalogQualityIssue,
} from './catalog-quality.server.ts'
import { prisma } from './db.server.ts'

const now = new Date('2026-07-23T12:00:00.000Z')

async function seedHydratedMedia(input: {
	id: string
	externalId: string
	title: string
	year: number
	thumbnail?: string | null
	sourceTitle?: string
}) {
	return prisma.media.create({
		data: {
			id: input.id,
			kind: 'movie',
			title: input.title,
			releaseStart: new Date(`${input.year}-05-01T00:00:00.000Z`),
			thumbnail:
				input.thumbnail === undefined
					? 'https://image.tmdb.org/t/p/w500/poster.jpg'
					: input.thumbnail,
			externalIds: {
				create: {
					id: `source-${input.id}`,
					provider: 'tmdb',
					kind: 'movie',
					externalId: input.externalId,
					sourceTitle: input.sourceTitle ?? input.title,
					lastFetchedAt: now,
					fetchStatus: 'fresh',
					firstSeenAt: now,
					lastSeenAt: now,
				},
			},
			titles: {
				create: {
					id: `title-${input.id}`,
					provider: 'tmdb',
					language: 'en',
					titleType: 'localized',
					value: input.title,
					normalized: input.title.toLowerCase(),
					isPrimary: true,
				},
			},
		},
		include: { externalIds: true, titles: true },
	})
}

test('detects exact title/year duplicates and local image quality issues', async () => {
	const first = await seedHydratedMedia({
		id: 'quality-first',
		externalId: '101',
		title: 'Shared Film',
		year: 2024,
		thumbnail: null,
	})
	const second = await seedHydratedMedia({
		id: 'quality-second',
		externalId: '102',
		title: 'Shared Film',
		year: 2024,
		thumbnail: 'http://images.example.test/poster.jpg',
	})

	const findings = detectCatalogQualityFindings([first, second])
	expect(findings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				issueType: 'possible_duplicate',
				primaryMediaId: 'quality-first',
				secondaryMediaId: 'quality-second',
			}),
			expect.objectContaining({
				issueType: 'missing_image',
				primaryMediaId: 'quality-first',
			}),
			expect.objectContaining({
				issueType: 'invalid_image',
				primaryMediaId: 'quality-second',
			}),
		]),
	)
})

test('dry-run is non-mutating and commit mode idempotently persists findings', async () => {
	await seedHydratedMedia({
		id: 'quality-dry-run',
		externalId: '201',
		title: 'No Poster',
		year: 2025,
		thumbnail: null,
	})

	const preview = await scanCatalogQuality(prisma, {
		limit: 10,
		commit: false,
		now,
	})
	expect(preview.findings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ issueType: 'missing_image' }),
		]),
	)
	expect(await prisma.catalogQualityIssue.count()).toBe(0)

	await scanCatalogQuality(prisma, { limit: 10, commit: true, now })
	await scanCatalogQuality(prisma, {
		limit: 10,
		commit: true,
		now: new Date(now.getTime() + 1_000),
	})
	expect(await prisma.catalogQualityIssue.count()).toBe(preview.findings.length)
})

test('review transitions are audited, reversible, and queue safe provider repair', async () => {
	const actor = await prisma.user.create({
		data: {
			id: 'quality-admin',
			email: 'quality-admin@example.com',
			username: 'quality-admin',
		},
	})
	await seedHydratedMedia({
		id: 'quality-repair',
		externalId: '301',
		title: 'Repair Poster',
		year: 2026,
		thumbnail: null,
	})
	await scanCatalogQuality(prisma, { limit: 10, commit: true, now })
	const issue = await prisma.catalogQualityIssue.findFirstOrThrow({
		where: {
			issueType: 'missing_image',
			primaryMediaId: 'quality-repair',
		},
	})

	const queued = await transitionCatalogQualityIssue(prisma, {
		issueId: issue.id,
		action: 'queue-repair',
		actorId: actor.id,
		note: 'Refresh the missing provider poster.',
		now,
	})
	expect(queued.queuedSources).toBe(1)
	expect(queued.issue.status).toBe('queued')
	await expect(
		transitionCatalogQualityIssue(prisma, {
			issueId: issue.id,
			action: 'queue-repair',
			actorId: actor.id,
			now: new Date(now.getTime() + 500),
		}),
	).rejects.toThrow('from queued')
	expect(
		await prisma.mediaExternalId.findUniqueOrThrow({
			where: { id: 'source-quality-repair' },
			select: {
				fetchStatus: true,
				hydrationPriority: true,
				hydrationReason: true,
			},
		}),
	).toEqual({
		fetchStatus: 'pending',
		hydrationPriority: 50_000,
		hydrationReason: 'catalog-quality-repair',
	})

	const reopened = await transitionCatalogQualityIssue(prisma, {
		issueId: issue.id,
		action: 'reopen',
		actorId: actor.id,
		now: new Date(now.getTime() + 1_000),
	})
	expect(reopened.issue.status).toBe('open')
	expect(
		await prisma.catalogQualityEvent.findMany({
			where: { issueId: issue.id },
			orderBy: { createdAt: 'asc' },
			select: {
				action: true,
				previousStatus: true,
				nextStatus: true,
			},
		}),
	).toEqual([
		{
			action: 'queue-repair',
			previousStatus: 'open',
			nextStatus: 'queued',
		},
		{
			action: 'reopen',
			previousStatus: 'queued',
			nextStatus: 'open',
		},
	])
	const snapshot = await getCatalogQualitySnapshot(prisma)
	expect(snapshot.counts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				status: 'open',
				issueType: 'missing_image',
			}),
		]),
	)
})

test('snapshot keeps actionable findings ahead of more recently scanned reviews', async () => {
	const actor = await prisma.user.create({
		data: {
			id: 'quality-order-admin',
			email: 'quality-order-admin@example.com',
			username: 'quality-order-admin',
		},
	})
	await seedHydratedMedia({
		id: 'quality-active',
		externalId: '401',
		title: 'Active Missing Poster',
		year: 2026,
		thumbnail: null,
	})
	await seedHydratedMedia({
		id: 'quality-reviewed',
		externalId: '402',
		title: 'Reviewed Missing Poster',
		year: 2026,
		thumbnail: null,
	})
	await scanCatalogQuality(prisma, { limit: 10, commit: true, now })
	const reviewed = await prisma.catalogQualityIssue.findFirstOrThrow({
		where: { primaryMediaId: 'quality-reviewed', issueType: 'missing_image' },
	})
	await transitionCatalogQualityIssue(prisma, {
		issueId: reviewed.id,
		action: 'dismiss',
		actorId: actor.id,
		now: new Date(now.getTime() + 1_000),
	})
	await prisma.catalogQualityIssue.update({
		where: { id: reviewed.id },
		data: { lastSeenAt: new Date(now.getTime() + 10_000) },
	})

	const snapshot = await getCatalogQualitySnapshot(prisma, { issueLimit: 1 })
	expect(snapshot.issues).toHaveLength(1)
	expect(snapshot.issues[0]).toMatchObject({
		status: 'open',
		primaryMediaId: 'quality-active',
	})
})
