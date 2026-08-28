import { afterEach, expect, test, vi } from 'vitest'
import { prisma } from './db.server.ts'
import {
	enrichPersonDetails,
	normalizeTmdbPersonDetails,
	PERSON_DETAILS_FAILURE_BACKOFF_MS,
	PERSON_DETAILS_PROVIDER_COOLDOWN_MS,
	PERSON_DETAILS_PROVIDER_FAILURE_THRESHOLD,
	personDetailsSelect,
	resetPersonDetailsRuntimeStateForTests,
	schedulePersonDetailsRefresh,
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

test('a page never waits for the provider', async () => {
	// Enrichment is a live provider request and a catalog write. Awaiting it puts
	// TMDB's latency on the first view of every person, and a provider outage on
	// every one of them, for data that is a biography and a birthday.
	const person = await fixture('person-background')
	let released = () => {}
	const held = new Promise<Response>(resolve => {
		released = () =>
			resolve(
				new Response(JSON.stringify({ id: 287, name: 'Fetched Name' }), {
					headers: { 'content-type': 'application/json' },
				}),
			)
	})

	// Returns while the provider is still hanging.
	schedulePersonDetailsRefresh(prisma, person, {
		apiToken: 'token',
		fetchImpl: () => held,
	})
	expect(true).toBe(true)

	released()
	await vi.waitFor(async () => {
		const stored = await prisma.person.findUniqueOrThrow({
			where: { id: person.id },
			select: { name: true },
		})
		// It still lands — just not on the request's clock.
		expect(stored.name).toBe('Fetched Name')
	})
})

test('a scheduled refresh cannot take the process down', async () => {
	// Nothing awaits it, so an unhandled rejection here is a crashed server
	// rather than a failed page.
	const person = await fixture('person-background-throws')
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	schedulePersonDetailsRefresh(prisma, person, {
		apiToken: 'token',
		fetchImpl: () => {
			throw new Error('provider exploded')
		},
	})
	await vi.waitFor(() => expect(warn).toHaveBeenCalled())
})

test('a provider-wide outage stops being asked about', async () => {
	// Per-person backoff cannot see an outage: every person someone views is a
	// fresh id with no backoff recorded, so each one pays the full timeout for as
	// long as the provider is down.
	vi.spyOn(console, 'warn').mockImplementation(() => {})
	const fetchImpl = vi.fn(async () => new Response('', { status: 500 }))
	const now = new Date('2026-08-27T12:00:00.000Z')

	for (
		let index = 0;
		index < PERSON_DETAILS_PROVIDER_FAILURE_THRESHOLD;
		index++
	) {
		const person = await fixture(`outage-${index}`, `90${index}`)
		await enrichPersonDetails(prisma, person, {
			apiToken: 'token',
			fetchImpl,
			now,
		})
	}
	expect(fetchImpl).toHaveBeenCalledTimes(
		PERSON_DETAILS_PROVIDER_FAILURE_THRESHOLD,
	)

	// A person nobody has tried yet, during the cooldown.
	const untried = await fixture('outage-untried', '999')
	await enrichPersonDetails(prisma, untried, {
		apiToken: 'token',
		fetchImpl,
		now,
	})
	expect(fetchImpl).toHaveBeenCalledTimes(
		PERSON_DETAILS_PROVIDER_FAILURE_THRESHOLD,
	)

	// And it lifts, rather than latching forever.
	await enrichPersonDetails(prisma, untried, {
		apiToken: 'token',
		fetchImpl,
		now: new Date(now.getTime() + PERSON_DETAILS_PROVIDER_COOLDOWN_MS + 1),
	})
	expect(fetchImpl).toHaveBeenCalledTimes(
		PERSON_DETAILS_PROVIDER_FAILURE_THRESHOLD + 1,
	)
})

test('one success clears the outage, so a single bad title cannot trip it', async () => {
	vi.spyOn(console, 'warn').mockImplementation(() => {})
	const now = new Date('2026-08-27T12:00:00.000Z')
	for (const [index, id] of ['mixed-fail-1', 'mixed-fail-2'].entries()) {
		const failing = await fixture(id, `80${index}`)
		await enrichPersonDetails(prisma, failing, {
			apiToken: 'token',
			fetchImpl: async () => new Response('', { status: 500 }),
			now,
		})
	}
	const working = await fixture('mixed-ok', '802')
	await enrichPersonDetails(prisma, working, {
		apiToken: 'token',
		fetchImpl: async () =>
			new Response(JSON.stringify({ id: 802, name: 'Fine' }), {
				headers: { 'content-type': 'application/json' },
			}),
		now,
	})

	// Two more failures. Counting from zero that is below the threshold, so a
	// third person is still tried. Counting cumulatively it is not — which is
	// what makes this discriminate.
	const fetchImpl = vi.fn(async () => new Response('', { status: 500 }))
	for (const [index, id] of ['mixed-a', 'mixed-b'].entries()) {
		const person = await fixture(id, `80${3 + index}`)
		await enrichPersonDetails(prisma, person, {
			apiToken: 'token',
			fetchImpl,
			now,
		})
	}
	const third = await fixture('mixed-c', '805')
	await enrichPersonDetails(prisma, third, {
		apiToken: 'token',
		fetchImpl,
		now,
	})
	expect(fetchImpl).toHaveBeenCalledTimes(3)
})

test("the provider's own Retry-After is honoured rather than guessed at", async () => {
	// Being told when to come back and ignoring it is how a client earns a
	// longer ban.
	vi.spyOn(console, 'warn').mockImplementation(() => {})
	const now = new Date('2026-08-27T12:00:00.000Z')
	const person = await fixture('retry-after', '805')
	const fetchImpl = vi.fn(
		async () =>
			new Response('', { status: 429, headers: { 'retry-after': '3600' } }),
	)
	await enrichPersonDetails(prisma, person, {
		apiToken: 'token',
		fetchImpl,
		now,
	})

	// Well past the flat five-minute backoff and past the provider's own default
	// cooldown, but still inside the hour the provider asked for.
	await enrichPersonDetails(prisma, person, {
		apiToken: 'token',
		fetchImpl,
		now: new Date(now.getTime() + PERSON_DETAILS_PROVIDER_COOLDOWN_MS * 2),
	})
	expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('a person the provider does not have is not asked for every five minutes', async () => {
	// A 404 is not transient. Retrying it forever turns a permanent absence into
	// a standing request.
	vi.spyOn(console, 'warn').mockImplementation(() => {})
	const now = new Date('2026-08-27T12:00:00.000Z')
	const person = await fixture('gone', '806')
	const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
	await enrichPersonDetails(prisma, person, {
		apiToken: 'token',
		fetchImpl,
		now,
	})

	await enrichPersonDetails(prisma, person, {
		apiToken: 'token',
		fetchImpl,
		now: new Date(now.getTime() + PERSON_DETAILS_FAILURE_BACKOFF_MS * 10),
	})
	expect(fetchImpl).toHaveBeenCalledTimes(1)
})
