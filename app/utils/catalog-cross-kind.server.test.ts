import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { detectCrossKindDuplicates } from './catalog-quality.server.ts'
import { prisma } from './db.server.ts'
import {
	TMDB_WATCH_PROVIDER_KEY,
	TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
} from './tmdb-anime-match.server.ts'

/**
 * Finding an anime row and a live-action row that are the same work.
 *
 * The evidence is an exact provider id, never a title. Cross-kind title
 * equality over this catalog is almost entirely false positives.
 */

async function overlap({
	tmdbId,
	tmdbKind = 'tv',
	animeKind = 'anime',
	liveKind = 'tv',
}: {
	tmdbId: string
	tmdbKind?: string
	animeKind?: string
	liveKind?: string
}) {
	const anime = await prisma.media.create({
		data: {
			kind: animeKind,
			title: `Anime ${tmdbId}`,
			externalIds: {
				create: {
					provider: TMDB_WATCH_PROVIDER_KEY,
					kind: tmdbKind,
					externalId: tmdbId,
				},
			},
		},
	})
	const liveAction = await prisma.media.create({
		data: {
			kind: liveKind,
			title: `Live action ${tmdbId}`,
			externalIds: {
				create: { provider: 'tmdb', kind: tmdbKind, externalId: tmdbId },
			},
		},
	})
	return { anime, liveAction }
}

function tmdbId() {
	return String(faker.number.int({ min: 100_000, max: 999_999 }))
}

test('an anime and a live-action row sharing a TMDB entry are paired', async () => {
	const id = tmdbId()
	const { anime, liveAction } = await overlap({ tmdbId: id })

	const { findings } = await detectCrossKindDuplicates(prisma)
	const found = findings.find(finding => finding.primaryMediaId === anime.id)

	expect(found).toBeDefined()
	// Anime is primary because primary is the row that survives the merge.
	expect(found?.secondaryMediaId).toBe(liveAction.id)
	expect(found?.issueType).toBe('cross_kind_duplicate')
	// An exact id, not a similarity score.
	expect(found?.confidence).toBe(1)
	expect(JSON.parse(found!.evidence)).toMatchObject({
		reasons: ['shared-tmdb-identity'],
		tmdbId: id,
	})
})

test('a refused mapping is never joined against', async () => {
	// `tmdb-watch-unresolved` stores the MEDIA id in externalId, not a TMDB id.
	// Joining those would pair completely unrelated works.
	const anime = await prisma.media.create({
		data: { kind: 'anime', title: 'Refused anime' },
	})
	await prisma.mediaExternalId.create({
		data: {
			mediaId: anime.id,
			provider: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
			kind: 'tv',
			externalId: anime.id,
		},
	})
	// A live-action row whose TMDB id happens to equal that media id.
	const decoy = await prisma.media.create({
		data: {
			kind: 'tv',
			title: 'Unrelated show',
			externalIds: {
				create: { provider: 'tmdb', kind: 'tv', externalId: anime.id },
			},
		},
	})

	const { findings } = await detectCrossKindDuplicates(prisma)
	expect(findings.some(f => f.primaryMediaId === anime.id)).toBe(false)
	expect(findings.some(f => f.secondaryMediaId === decoy.id)).toBe(false)
})

test('a mapping with no live-action counterpart is not an overlap', async () => {
	const anime = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Only anime',
			externalIds: {
				create: {
					provider: TMDB_WATCH_PROVIDER_KEY,
					kind: 'tv',
					externalId: tmdbId(),
				},
			},
		},
	})
	const { findings } = await detectCrossKindDuplicates(prisma)
	expect(findings.some(f => f.primaryMediaId === anime.id)).toBe(false)
})

test('one row holding both keys is not an overlap with itself', async () => {
	const id = tmdbId()
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Both keys',
			externalIds: {
				create: [
					{ provider: TMDB_WATCH_PROVIDER_KEY, kind: 'tv', externalId: id },
					{ provider: 'tmdb', kind: 'tv', externalId: id },
				],
			},
		},
	})
	const { findings } = await detectCrossKindDuplicates(prisma)
	expect(findings.some(f => f.primaryMediaId === media.id)).toBe(false)
})

test('a tombstoned identity stops producing overlaps', async () => {
	// This is what a completed merge leaves behind. Detecting it again would
	// offer the admin a merge that has already happened.
	const id = tmdbId()
	const { anime, liveAction } = await overlap({ tmdbId: id })
	await prisma.mediaExternalId.updateMany({
		where: { mediaId: liveAction.id, provider: 'tmdb' },
		data: { tombstonedAt: new Date() },
	})

	const { findings } = await detectCrossKindDuplicates(prisma)
	expect(findings.some(f => f.primaryMediaId === anime.id)).toBe(false)
})

test('a mapping that does not belong to an anime row is refused', async () => {
	// Anime always survives a cross-kind merge, so a pair that could not honour
	// that must never become a merge plan.
	const id = tmdbId()
	const { anime } = await overlap({ tmdbId: id, animeKind: 'manga' })
	const { findings } = await detectCrossKindDuplicates(prisma)
	expect(findings.some(f => f.primaryMediaId === anime.id)).toBe(false)
})

test('the counterpart must be live action, not another anime', async () => {
	const id = tmdbId()
	const { anime } = await overlap({ tmdbId: id, liveKind: 'anime' })
	const { findings } = await detectCrossKindDuplicates(prisma)
	expect(findings.some(f => f.primaryMediaId === anime.id)).toBe(false)
})

test('the scan is bounded and resumable', async () => {
	await Promise.all(
		Array.from({ length: 3 }, () => overlap({ tmdbId: tmdbId() })),
	)
	const first = await detectCrossKindDuplicates(prisma, { limit: 2 })
	expect(first.scanned).toBe(2)
	expect(first.nextCursor).not.toBeNull()
	const second = await detectCrossKindDuplicates(prisma, {
		limit: 2,
		afterId: first.nextCursor!,
	})
	// A cursor moves forward rather than re-reading the same mappings.
	expect(second.nextCursor).not.toBe(first.nextCursor)
})
