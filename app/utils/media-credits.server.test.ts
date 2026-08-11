import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import {
	boundCast,
	boundCrew,
	dedupeCredits,
	MAX_CAST_PER_TITLE,
	MAX_CREW_PER_TITLE,
	MAX_ROLE_LENGTH,
	normalizeMalAuthorCredits,
	normalizePersonName,
	normalizeTmdbCredits,
	replaceCatalogCredits,
	tmdbProfileUrl,
	type CatalogCreditInput,
} from './media-credits.server.ts'

function castEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: 100,
		name: 'Anna Lead',
		character: 'The Lead',
		profile_path: '/anna.jpg',
		known_for_department: 'Acting',
		order: 0,
		...overrides,
	}
}

test('a film payload yields cast in billing order and crew by job', () => {
	const credits = normalizeTmdbCredits({
		credits: {
			cast: [
				castEntry({ id: 2, name: 'Second Billed', order: 1 }),
				castEntry({ id: 1, name: 'First Billed', order: 0 }),
			],
			crew: [
				{ id: 9, name: 'A Gaffer', job: 'Gaffer', department: 'Lighting' },
				{ id: 8, name: 'A Director', job: 'Director', department: 'Directing' },
			],
		},
	})

	const cast = credits.filter(credit => credit.creditType === 'cast')
	expect(cast.map(credit => credit.name)).toEqual([
		'First Billed',
		'Second Billed',
	])
	// Crew is ordered by what people look for, so a truncated list is still
	// useful rather than arbitrary.
	const crew = credits.filter(credit => credit.creditType === 'crew')
	expect(crew.map(credit => credit.role)).toEqual(['Director', 'Gaffer'])
	expect(crew[0]).toMatchObject({ department: 'Directing' })
})

test('a series is read from aggregate_credits, not credits', () => {
	// `credits` on a series returns whoever happened to be on the last season,
	// which is not the cast. `aggregate_credits` rolls roles up across seasons
	// and carries the episode counts.
	const credits = normalizeTmdbCredits({
		aggregate_credits: {
			cast: [
				{
					id: 5,
					name: 'Long Runner',
					profile_path: '/lr.jpg',
					order: 0,
					roles: [
						{ character: 'Young Version', episode_count: 12 },
						{ character: 'Older Version', episode_count: 30 },
					],
				},
			],
			crew: [
				{
					id: 6,
					name: 'Show Runner',
					department: 'Production',
					jobs: [{ job: 'Executive Producer', episode_count: 42 }],
				},
			],
		},
		// Present and deliberately ignored: preferring this would lose the
		// aggregate the series version exists to provide.
		credits: { cast: [castEntry({ id: 99, name: 'Should Not Appear' })] },
	})

	expect(credits.map(credit => credit.name)).not.toContain('Should Not Appear')
	const roles = credits
		.filter(credit => credit.creditType === 'cast')
		.map(credit => [credit.role, credit.episodeCount])
	// Both roles survive: they are different characters, and the database
	// distinguishes them.
	expect(roles).toEqual([
		['Young Version', 12],
		['Older Version', 30],
	])
	expect(credits.find(credit => credit.creditType === 'crew')).toMatchObject({
		role: 'Executive Producer',
		episodeCount: 42,
	})
})

test('a payload with no credits is not an error', () => {
	// Plenty of titles carry none, and hydration must not fail over it.
	expect(normalizeTmdbCredits({})).toEqual([])
	expect(normalizeTmdbCredits(null)).toEqual([])
	expect(normalizeTmdbCredits({ credits: {} })).toEqual([])
	expect(normalizeTmdbCredits({ credits: { cast: 'nonsense' } })).toEqual([])
})

test('entries missing an id or a name are dropped, not guessed at', () => {
	// Identity comes from the provider's id. An entry without one cannot be
	// attributed to anybody, and inventing a person for it would be worse than
	// losing the credit.
	const credits = normalizeTmdbCredits({
		credits: {
			cast: [
				castEntry({ id: null, name: 'No Id' }),
				castEntry({ id: 0, name: 'Zero Id' }),
				castEntry({ id: 7, name: '   ' }),
				castEntry({ id: 8, name: 'Kept' }),
			],
			crew: [{ id: 9, name: 'No Job', department: 'Crew' }],
		},
	})
	expect(credits.map(credit => credit.name)).toEqual(['Kept'])
})

test('cast with no billing order sorts last, never in front of a lead', () => {
	// A provider that gave no order made no claim about prominence; guessing one
	// would put an extra ahead of the star.
	const cast = boundCast([
		{ ...base(), name: 'Unordered', billingOrder: null },
		{ ...base(), name: 'Lead', billingOrder: 0 },
	])
	expect(cast.map(credit => credit.name)).toEqual(['Lead', 'Unordered'])
})

test('the caps keep the people worth keeping', () => {
	const cast = boundCast(
		Array.from({ length: MAX_CAST_PER_TITLE + 20 }, (_, index) => ({
			...base(),
			name: `Actor ${index}`,
			billingOrder: index,
		})),
	)
	expect(cast).toHaveLength(MAX_CAST_PER_TITLE)
	expect(cast[0]!.name).toBe('Actor 0')

	// The director survives a crowd of grips, whatever order they arrived in.
	const crew = boundCrew([
		...Array.from({ length: MAX_CREW_PER_TITLE + 20 }, (_, index) => ({
			...base(),
			creditType: 'crew' as const,
			name: `Grip ${index}`,
			role: 'Grip',
		})),
		{
			...base(),
			creditType: 'crew' as const,
			name: 'The Director',
			role: 'Director',
		},
	])
	expect(crew).toHaveLength(MAX_CREW_PER_TITLE)
	expect(crew[0]).toMatchObject({ name: 'The Director', role: 'Director' })
})

test('a character name that is really a description is bounded', () => {
	const credits = normalizeTmdbCredits({
		credits: { cast: [castEntry({ character: 'x'.repeat(500) })] },
	})
	expect(credits[0]!.role).toHaveLength(MAX_ROLE_LENGTH)
})

test('credits that would collide in the database are collapsed first', () => {
	// The uniqueness is (media, person, type, role, department), and a payload
	// can repeat one. Without this the whole write fails, not just the duplicate.
	const duplicate = { ...base(), creditType: 'crew' as const, role: 'Director' }
	expect(dedupeCredits([duplicate, { ...duplicate }])).toHaveLength(1)
	// A person who directed and wrote is still two credits.
	expect(
		dedupeCredits([duplicate, { ...duplicate, role: 'Writer' }]),
	).toHaveLength(2)
})

test('names fold the same way titles do', () => {
	// A name and a title have to match by the same rules, or a search finds one
	// and misses the other.
	expect(normalizePersonName('Léa  Seydoux')).toBe('lea seydoux')
	expect(normalizePersonName('Bong Joon-ho')).toBe('bong joon ho')
	expect(normalizePersonName('  ')).toBe('')
})

test('a portrait path becomes a url, and anything else becomes nothing', () => {
	expect(tmdbProfileUrl('/abc.jpg')).toBe(
		'https://image.tmdb.org/t/p/w185/abc.jpg',
	)
	expect(tmdbProfileUrl(null)).toBeNull()
	expect(tmdbProfileUrl('')).toBeNull()
	// Not a path: refusing it keeps an absolute stranger's URL out of an img tag.
	expect(tmdbProfileUrl('https://elsewhere.example/x.jpg')).toBeNull()
})

test('MAL authors become credits with their own person ids', () => {
	// MAL's official API has no cast, but a manga's authors are named people,
	// and they belong in the same table as everyone else.
	const credits = normalizeMalAuthorCredits({
		authors: [
			{
				node: { id: 1868, first_name: 'Hajime', last_name: 'Isayama' },
				role: 'Story & Art',
			},
			{ node: { id: 2, first_name: '', last_name: 'Mononym' }, role: 'Art' },
			{ node: { id: null, first_name: 'No', last_name: 'Id' }, role: 'Story' },
		],
	})
	expect(credits).toHaveLength(2)
	expect(credits[0]).toMatchObject({
		externalId: '1868',
		name: 'Hajime Isayama',
		creditType: 'crew',
		role: 'Story & Art',
		department: 'Writing',
	})
	// Half a name is still a name.
	expect(credits[1]!.name).toBe('Mononym')
})

function base(): CatalogCreditInput {
	return {
		externalId: '1',
		name: 'Someone',
		imageUrl: null,
		knownForDepartment: null,
		creditType: 'cast',
		role: 'A Role',
		department: '',
		billingOrder: null,
		episodeCount: null,
	}
}

// --- the writer, against the database -------------------------------------

async function mediaFixture() {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	return prisma.media.create({
		data: { kind: 'movie', title: `Credit writer fixture ${tag}` },
	})
}

function person(
	externalId: string,
	overrides: Partial<CatalogCreditInput> = {},
) {
	return { ...base(), externalId, name: `Person ${externalId}`, ...overrides }
}

test('a person is created once and shared by every title they work on', async () => {
	// This is the entire reason people are their own row.
	const [first, second] = await Promise.all([mediaFixture(), mediaFixture()])
	const shared = person('shared-1')

	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: first.id,
			provider: 'tmdb',
			credits: [shared],
		}),
	)
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: second.id,
			provider: 'tmdb',
			credits: [shared],
		}),
	)

	const identities = await prisma.personExternalId.findMany({
		where: { provider: 'tmdb', externalId: 'shared-1' },
	})
	expect(identities).toHaveLength(1)
	expect(
		await prisma.mediaCredit.count({
			where: { personId: identities[0]!.personId },
		}),
	).toBe(2)
})

test('a refresh restates rather than accumulates', async () => {
	// A credit the provider no longer lists should stop existing, and one it
	// still lists should not be written twice.
	const media = await mediaFixture()
	const write = (credits: CatalogCreditInput[]) =>
		prisma.$transaction(tx =>
			replaceCatalogCredits(tx, {
				mediaId: media.id,
				provider: 'tmdb',
				credits,
			}),
		)

	await write([person('a'), person('b')])
	await write([person('a'), person('c')])

	const remaining = await prisma.mediaCredit.findMany({
		where: { mediaId: media.id },
		select: { person: { select: { externalIds: true } } },
	})
	expect(remaining).toHaveLength(2)
	expect(
		remaining.map(credit => credit.person.externalIds[0]!.externalId).sort(),
	).toEqual(['a', 'c'])
	// The dropped person survives — they may be credited elsewhere.
	expect(
		await prisma.personExternalId.count({ where: { externalId: 'b' } }),
	).toBe(1)
})

test('one provider refreshing does not delete what another wrote', async () => {
	// A manga has MAL authors; the same row could later gain TMDB credits. A
	// refresh of either must leave the other alone.
	const media = await mediaFixture()
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'mal',
			credits: [person('mal-1')],
		}),
	)
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [person('tmdb-1')],
		}),
	)
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [person('tmdb-2')],
		}),
	)

	expect(
		await prisma.mediaCredit.count({
			where: { mediaId: media.id, provider: 'mal' },
		}),
	).toBe(1)
	expect(
		await prisma.mediaCredit.count({
			where: { mediaId: media.id, provider: 'tmdb' },
		}),
	).toBe(1)
})

test('an empty payload clears the credits rather than leaving stale ones', async () => {
	const media = await mediaFixture()
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [person('gone')],
		}),
	)
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [],
		}),
	)
	expect(await prisma.mediaCredit.count({ where: { mediaId: media.id } })).toBe(
		0,
	)
})

test('a portrait that arrives later is picked up', async () => {
	// A person first seen without one should not be stuck without one forever:
	// a blank page is the visible cost of never looking again.
	const media = await mediaFixture()
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [person('late-photo', { imageUrl: null })],
		}),
	)
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [
				person('late-photo', {
					imageUrl: 'https://image.tmdb.org/t/p/w185/l.jpg',
				}),
			],
		}),
	)

	const identity = await prisma.personExternalId.findUnique({
		where: {
			provider_externalId: { provider: 'tmdb', externalId: 'late-photo' },
		},
		select: { person: { select: { imageUrl: true } } },
	})
	expect(identity?.person.imageUrl).toBe(
		'https://image.tmdb.org/t/p/w185/l.jpg',
	)
})

test('a person credited twice on one title is still one person', async () => {
	// Someone who directed and starred is two credits and one row.
	const media = await mediaFixture()
	await prisma.$transaction(tx =>
		replaceCatalogCredits(tx, {
			mediaId: media.id,
			provider: 'tmdb',
			credits: [
				person('double', {
					creditType: 'cast',
					role: 'Himself',
					billingOrder: 0,
				}),
				person('double', {
					creditType: 'crew',
					role: 'Director',
					department: 'Directing',
				}),
			],
		}),
	)
	expect(
		await prisma.personExternalId.count({ where: { externalId: 'double' } }),
	).toBe(1)
	expect(await prisma.mediaCredit.count({ where: { mediaId: media.id } })).toBe(
		2,
	)
})

test('a payload that repeats a credit is written once, not refused', async () => {
	// Providers do repeat one. Without collapsing them first the whole write
	// fails on the unique index, so a single duplicated line would cost a title
	// its entire cast rather than one row.
	const media = await mediaFixture()
	const repeated = person('repeated', {
		creditType: 'crew',
		role: 'Director',
		department: 'Directing',
	})

	await expect(
		prisma.$transaction(tx =>
			replaceCatalogCredits(tx, {
				mediaId: media.id,
				provider: 'tmdb',
				credits: [repeated, { ...repeated }, person('other')],
			}),
		),
	).resolves.toMatchObject({ credits: 2 })

	expect(await prisma.mediaCredit.count({ where: { mediaId: media.id } })).toBe(
		2,
	)
})
