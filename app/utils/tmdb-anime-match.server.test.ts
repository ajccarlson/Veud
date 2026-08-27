import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import {
	animeMatchCandidateWhere,
	normalizeAnimeMatchScope,
	TMDB_WATCH_PROVIDER_KEY,
	TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
} from './tmdb-anime-match.server.ts'

/**
 * Which anime the resolver will consider.
 *
 * The matching itself is covered next door; this is about the queue, which is
 * what widening changes. Getting it wrong either re-searches work already done
 * or silently skips the rows the widening was for.
 */

const now = new Date('2026-08-27T00:00:00.000Z')

function where(scope: 'tracked' | 'all') {
	return animeMatchCandidateWhere({
		now,
		trackedProviderKey: TMDB_WATCH_PROVIDER_KEY,
		unresolvedProviderKey: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
		scope,
	})
}

async function animeFixture() {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const owner = await prisma.user.create({
		data: { email: `scope_${tag}@example.com`, username: `scope_${tag}` },
	})
	const make = (title: string) =>
		prisma.media.create({ data: { kind: 'anime', title: `${title} ${tag}` } })

	const [tracked, untracked, mapped, refusedRecently, refusedLongAgo] =
		await Promise.all([
			make('tracked'),
			make('untracked'),
			make('mapped'),
			make('refused recently'),
			make('refused long ago'),
		])

	await prisma.trackingState.create({
		data: { ownerId: owner.id, mediaId: tracked.id, status: 'watching' },
	})
	await prisma.mediaExternalId.create({
		data: {
			mediaId: mapped.id,
			provider: TMDB_WATCH_PROVIDER_KEY,
			kind: 'tv',
			externalId: `tmdb-${tag}`,
		},
	})
	await prisma.mediaExternalId.createMany({
		data: [
			{
				mediaId: refusedRecently.id,
				provider: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
				kind: 'tv',
				externalId: refusedRecently.id,
				// Still inside its retry window.
				refreshAfter: new Date(now.getTime() + 86_400_000),
			},
			{
				mediaId: refusedLongAgo.id,
				provider: TMDB_WATCH_UNRESOLVED_PROVIDER_KEY,
				kind: 'tv',
				externalId: refusedLongAgo.id,
				refreshAfter: new Date(now.getTime() - 86_400_000),
			},
		],
	})

	return { tag, tracked, untracked, mapped, refusedRecently, refusedLongAgo }
}

async function selectedIds(scope: 'tracked' | 'all', tag: string) {
	const rows = await prisma.media.findMany({
		where: { AND: [where(scope), { title: { contains: tag } }] },
		select: { id: true },
	})
	return new Set(rows.map(row => row.id))
}

test('the tracked scope considers only anime somebody has on a list', async () => {
	const f = await animeFixture()
	const ids = await selectedIds('tracked', f.tag)
	expect(ids.has(f.tracked.id)).toBe(true)
	expect(ids.has(f.untracked.id)).toBe(false)
})

test('widening adds untracked anime and nothing else', async () => {
	// An anime nobody tracks can still be the same work as a live-action row,
	// which is the whole reason for widening.
	const f = await animeFixture()
	const ids = await selectedIds('all', f.tag)
	expect(ids.has(f.tracked.id)).toBe(true)
	expect(ids.has(f.untracked.id)).toBe(true)
	// Widening must not also start re-searching work already settled.
	expect(ids.has(f.mapped.id)).toBe(false)
	expect(ids.has(f.refusedRecently.id)).toBe(false)
})

test('a refusal is reconsidered once it expires, in either scope', async () => {
	// A refusal is a statement about today. A mapping is not, so it never
	// returns to the queue.
	const f = await animeFixture()
	for (const scope of ['tracked', 'all'] as const) {
		const ids = await selectedIds(scope, f.tag)
		expect(ids.has(f.mapped.id)).toBe(false)
		expect(ids.has(f.refusedRecently.id)).toBe(false)
	}
	// The long-expired refusal is untracked, so only the wide scope reaches it.
	expect((await selectedIds('all', f.tag)).has(f.refusedLongAgo.id)).toBe(true)
	expect((await selectedIds('tracked', f.tag)).has(f.refusedLongAgo.id)).toBe(
		false,
	)
})

test('an unknown scope stays at the narrow one', () => {
	// Widening spends provider requests, so it is never arrived at by accident.
	expect(normalizeAnimeMatchScope('all')).toBe('all')
	expect(normalizeAnimeMatchScope('tracked')).toBe('tracked')
	expect(normalizeAnimeMatchScope('everything')).toBe('tracked')
	expect(normalizeAnimeMatchScope(undefined)).toBe('tracked')
	expect(normalizeAnimeMatchScope('')).toBe('tracked')
})
