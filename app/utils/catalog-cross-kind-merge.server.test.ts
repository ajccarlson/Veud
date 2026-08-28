import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import {
	applyCatalogMediaMerge,
	buildCatalogMediaMergePreflight,
	prepareCatalogMediaMerge,
	revertCatalogMediaMerge,
} from './catalog-media-merge.server.ts'
import { expectedCatalogMergeConfirmation , expectedCatalogMergeReversal } from './catalog-media-merge.ts'
import { prisma } from './db.server.ts'
import { TMDB_WATCH_PROVIDER_KEY } from './tmdb-anime-match.server.ts'

/**
 * Resolving an anime/live-action overlap, with anime surviving.
 *
 * Differing kinds is normally the strongest evidence that two rows are NOT the
 * same work, so it stays a hard refusal everywhere except the one issue type
 * whose entire evidence is a shared provider id.
 */

const now = new Date('2026-08-27T18:00:00.000Z')
const TRUSTED = 1

async function crossKindFixture({
	targetKind = 'anime',
	sourceKind = 'tv',
}: { targetKind?: string; sourceKind?: string } = {}) {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const tmdbId = String(faker.number.int({ min: 100_000, max: 999_999 }))
	const admin = await prisma.user.create({
		data: {
			email: `xk_${tag}@example.com`,
			username: `xk_${tag}`,
		},
	})

	// The survivor: an anime carrying the mapping that proves the overlap.
	const anime = await prisma.media.create({
		data: {
			kind: targetKind,
			title: `Anime ${tag}`,
			catalogProvenanceVersion: TRUSTED,
			externalIds: {
				create: [
					{
						provider: TMDB_WATCH_PROVIDER_KEY,
						kind: 'tv',
						externalId: tmdbId,
					},
					{ provider: 'mal', kind: 'anime', externalId: `mal-${tag}` },
				],
			},
		},
	})
	// The absorbed record, carrying the real TMDB identity.
	const liveAction = await prisma.media.create({
		data: {
			kind: sourceKind,
			title: `Live action ${tag}`,
			catalogProvenanceVersion: TRUSTED,
			externalIds: {
				create: { provider: 'tmdb', kind: 'tv', externalId: tmdbId },
			},
		},
	})

	const issue = await prisma.catalogQualityIssue.create({
		data: {
			fingerprint: `xk-${tag}`,
			issueType: 'cross_kind_duplicate',
			status: 'confirmed',
			severity: 'warning',
			summary: 'Same TMDB entry',
			evidence: JSON.stringify({ reasons: ['shared-tmdb-identity'] }),
			primaryMediaId: anime.id,
			secondaryMediaId: liveAction.id,
			reviewedById: admin.id,
			reviewedAt: now,
		},
	})

	return { admin, issue, anime, liveAction, tmdbId }
}

test('anime absorbs the live-action record', async () => {
	const { issue, anime, liveAction } = await crossKindFixture()
	const preflight = await buildCatalogMediaMergePreflight(prisma, {
		issueId: issue.id,
		targetMediaId: anime.id,
		now,
	})
	expect(preflight.blockers.map(blocker => blocker.code)).not.toContain(
		'kind-mismatch',
	)
	expect(preflight.safe).toBe(true)
	expect(preflight.source.id).toBe(liveAction.id)
	expect(preflight.target.id).toBe(anime.id)
})

test('the direction is fixed: live action can never absorb anime', async () => {
	// Otherwise "prioritize anime" would depend on which record the admin
	// happened to click, which is not a guarantee.
	const { issue, liveAction } = await crossKindFixture()
	const preflight = await buildCatalogMediaMergePreflight(prisma, {
		issueId: issue.id,
		targetMediaId: liveAction.id,
		now,
	})
	expect(preflight.safe).toBe(false)
	expect(preflight.blockers.map(blocker => blocker.code)).toContain(
		'anime-must-survive',
	)
})

test('a manga or another anime is not something to absorb', async () => {
	// The relaxation is exactly "anime absorbs live action", not "kinds may
	// differ".
	const { issue, anime } = await crossKindFixture({ sourceKind: 'manga' })
	const preflight = await buildCatalogMediaMergePreflight(prisma, {
		issueId: issue.id,
		targetMediaId: anime.id,
		now,
	})
	expect(preflight.safe).toBe(false)
	expect(preflight.blockers.map(blocker => blocker.code)).toContain(
		'kind-mismatch',
	)
})

test('an ordinary duplicate still refuses to cross kinds', async () => {
	// The relaxation must not leak to the issue type that has no provider id
	// behind it.
	const { issue, anime } = await crossKindFixture()
	await prisma.catalogQualityIssue.update({
		where: { id: issue.id },
		data: { issueType: 'possible_duplicate' },
	})
	const preflight = await buildCatalogMediaMergePreflight(prisma, {
		issueId: issue.id,
		targetMediaId: anime.id,
		now,
	})
	expect(preflight.safe).toBe(false)
	expect(preflight.blockers.map(blocker => blocker.code)).toContain(
		'kind-mismatch',
	)
})

test('the absorbed TMDB identity is tombstoned, so hydration cannot take the row', async () => {
	// The identity moves onto the surviving anime record with everything else,
	// and it is what TMDB hydration selects on. Left active, the next run would
	// overwrite the MAL-sourced title and scores — "anime wins" at merge time
	// becoming "TMDB wins" an hour later.
	const { admin, issue, anime, liveAction, tmdbId } = await crossKindFixture()
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: issue.id,
		targetMediaId: anime.id,
		actorId: admin.id,
		now,
	})
	await applyCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeConfirmation(liveAction.id, anime.id),
		now: new Date(now.getTime() + 1_000),
	})

	const absorbed = await prisma.mediaExternalId.findUniqueOrThrow({
		where: {
			provider_kind_externalId: {
				provider: 'tmdb',
				kind: 'tv',
				externalId: tmdbId,
			},
		},
	})
	// Moved, not deleted — and inert.
	expect(absorbed.mediaId).toBe(anime.id)
	expect(absorbed.tombstonedAt).not.toBeNull()

	// The mapping that proved the overlap is untouched, so streaming still
	// resolves for the surviving record.
	const mapping = await prisma.mediaExternalId.findFirst({
		where: { mediaId: anime.id, provider: TMDB_WATCH_PROVIDER_KEY },
	})
	expect(mapping?.tombstonedAt).toBeNull()
})

test('reverting brings the identity back to life', async () => {
	// Otherwise a reverted merge restores the live-action record but leaves it
	// invisible to hydration forever.
	const { admin, issue, anime, liveAction, tmdbId } = await crossKindFixture()
	const prepared = await prepareCatalogMediaMerge(prisma, {
		issueId: issue.id,
		targetMediaId: anime.id,
		actorId: admin.id,
		now,
	})
	const applied = await applyCatalogMediaMerge(prisma, {
		mergeId: prepared.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeConfirmation(liveAction.id, anime.id),
		now: new Date(now.getTime() + 1_000),
	})
	await revertCatalogMediaMerge(prisma, {
		mergeId: applied.merge.id,
		actorId: admin.id,
		confirmation: expectedCatalogMergeReversal(applied.merge.id),
		now: new Date(now.getTime() + 2_000),
	})

	const restored = await prisma.mediaExternalId.findUniqueOrThrow({
		where: {
			provider_kind_externalId: {
				provider: 'tmdb',
				kind: 'tv',
				externalId: tmdbId,
			},
		},
	})
	expect(restored.mediaId).toBe(liveAction.id)
	expect(restored.tombstonedAt).toBeNull()
})
