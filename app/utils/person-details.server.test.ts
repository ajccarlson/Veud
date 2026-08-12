import { afterEach, expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	enrichPersonDetails,
	normalizeTmdbPersonDetails,
	PERSON_DETAILS_FAILURE_BACKOFF_MS,
	personDetailsSelect,
	resetPersonDetailsRuntimeStateForTests,
} from './person-details.server.ts'

afterEach(() => {
	resetPersonDetailsRuntimeStateForTests()
	vi.restoreAllMocks()
})

async function fixture(id: string, externalId = '287') {
	return prisma.person.create({
		data: {
			id,
			name: 'Stored Name',
			normalized: 'stored name',
			externalIds: {
				create: { provider: 'tmdb', externalId },
			},
		},
		select: personDetailsSelect,
	})
}

test('fetches, validates, stores, and then serves fresh person details', async () => {
	const person = await fixture('person-details-cache')
	const now = new Date('2026-08-11T12:00:00Z')
	const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
		expect(String(input)).toBe(
			'https://api.themoviedb.org/3/person/287?language=en-US',
		)
		expect(new Headers(init?.headers).get('authorization')).toBe(
			'Bearer provider-token',
		)
		return Response.json({
			id: 287,
			name: 'Brad Pitt',
			profile_path: '/portrait.jpg',
			known_for_department: 'Acting',
			biography: 'A bounded biography.',
			birthday: '1963-12-18',
			deathday: null,
			place_of_birth: 'Shawnee, Oklahoma, USA',
			gender: 2,
			homepage: 'https://example.com/brad',
		})
	})

	const enriched = await enrichPersonDetails(prisma, person, {
		apiToken: 'provider-token',
		fetchImpl,
		now,
	})
	expect(enriched).toMatchObject({
		name: 'Brad Pitt',
		imageUrl: 'https://image.tmdb.org/t/p/w500/portrait.jpg',
		knownForDepartment: 'Acting',
		biography: 'A bounded biography.',
		birthday: new Date('1963-12-18T00:00:00.000Z'),
		placeOfBirth: 'Shawnee, Oklahoma, USA',
		gender: 'Male',
		homepage: 'https://example.com/brad',
		detailsFetchedAt: now,
	})
	const identityLookups = vi.spyOn(prisma.personExternalId, 'findFirst')
	await enrichPersonDetails(prisma, enriched, {
		apiToken: 'provider-token',
		fetchImpl,
		now: new Date('2026-08-12T12:00:00Z'),
	})
	expect(fetchImpl).toHaveBeenCalledTimes(1)
	expect(identityLookups).not.toHaveBeenCalled()
})

test('coalesces simultaneous first views into one provider request', async () => {
	const person = await fixture('person-details-coalesce', '500')
	let release!: () => void
	const gate = new Promise<void>(resolve => (release = resolve))
	const fetchImpl = vi.fn<typeof fetch>(async () => {
		await gate
		return Response.json({ id: 500, name: 'One Request' })
	})
	const options = {
		apiToken: 'provider-token',
		fetchImpl,
		now: new Date('2026-08-11T12:00:00Z'),
	}
	const first = enrichPersonDetails(prisma, person, options)
	const second = enrichPersonDetails(prisma, person, options)
	release()
	await expect(Promise.all([first, second])).resolves.toEqual([
		expect.objectContaining({ name: 'One Request' }),
		expect.objectContaining({ name: 'One Request' }),
	])
	expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('falls back to stored data and backs off after provider failure', async () => {
	const person = await fixture('person-details-failure', '900')
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(null, { status: 503 }))
		.mockResolvedValueOnce(Response.json({ id: 900, name: 'Recovered' }))
	const options = {
		apiToken: 'provider-token',
		fetchImpl,
		now: new Date('2026-08-11T12:00:00Z'),
	}
	await expect(enrichPersonDetails(prisma, person, options)).resolves.toBe(
		person,
	)
	await expect(enrichPersonDetails(prisma, person, options)).resolves.toBe(
		person,
	)
	expect(fetchImpl).toHaveBeenCalledTimes(1)
	expect(warning).toHaveBeenCalledWith(
		expect.stringContaining('TMDB person request failed with 503'),
	)
	await expect(
		enrichPersonDetails(prisma, person, {
			...options,
			now: new Date(
				options.now.getTime() + PERSON_DETAILS_FAILURE_BACKOFF_MS + 1,
			),
		}),
	).resolves.toMatchObject({ name: 'Recovered' })
	expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('rejects mismatched identities and drops unsafe optional values', () => {
	expect(() =>
		normalizeTmdbPersonDetails({ id: 8, name: 'Wrong' }, '9'),
	).toThrow('did not match')
	expect(
		normalizeTmdbPersonDetails(
			{
				id: 9,
				name: 'Safe Name',
				profile_path: 'https://evil.example/portrait',
				birthday: '2025-02-29',
				homepage: 'javascript:alert(1)',
				gender: 99,
			},
			'9',
		),
	).toMatchObject({
		imageUrl: null,
		birthday: null,
		homepage: null,
		gender: null,
	})
})
