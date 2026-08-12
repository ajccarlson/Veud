import { type Prisma, type PrismaClient } from '@prisma/client'
import { normalizePersonName } from './media-credits.server.ts'

export const PERSON_DETAILS_FRESH_MS = 30 * 24 * 60 * 60 * 1000
export const PERSON_DETAILS_FAILURE_BACKOFF_MS = 5 * 60 * 1000
const PERSON_DETAILS_TIMEOUT_MS = 3_000
const PERSON_DETAILS_MAX_FAILURE_BACKOFFS = 1_000

export const personDetailsSelect = {
	id: true,
	name: true,
	imageUrl: true,
	knownForDepartment: true,
	biography: true,
	birthday: true,
	deathday: true,
	placeOfBirth: true,
	gender: true,
	homepage: true,
	detailsFetchedAt: true,
} satisfies Prisma.PersonSelect

export type PersonDetailsRecord = Prisma.PersonGetPayload<{
	select: typeof personDetailsSelect
}>

type PersonDetailsDatabase = Pick<PrismaClient, 'person' | 'personExternalId'>

type EnrichmentOptions = {
	apiToken?: string | null
	fetchImpl?: typeof fetch
	now?: Date
	timeoutMs?: number
}

const inFlight = new Map<string, Promise<PersonDetailsRecord>>()
const retryAfter = new Map<string, number>()

function failureBackoffActive(personId: string, now: number) {
	for (const [id, expiresAt] of retryAfter) {
		if (expiresAt <= now) retryAfter.delete(id)
	}
	return (retryAfter.get(personId) ?? 0) > now
}

function rememberFailure(personId: string, retryAt: number) {
	retryAfter.delete(personId)
	retryAfter.set(personId, retryAt)
	while (retryAfter.size > PERSON_DETAILS_MAX_FAILURE_BACKOFFS) {
		const oldest = retryAfter.keys().next().value
		if (!oldest) break
		retryAfter.delete(oldest)
	}
}

function configuredApiToken(options: EnrichmentOptions) {
	return (
		options.apiToken === undefined ? process.env.TMDB_API_KEY : options.apiToken
	)?.trim()
}

function record(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function text(value: unknown, limit: number) {
	if (typeof value !== 'string') return null
	const result = value.trim()
	return result && result.length <= limit ? result : null
}

function tmdbId(value: unknown) {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
		return String(value)
	}
	if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
		const parsed = Number(value.trim())
		return Number.isSafeInteger(parsed) ? value.trim() : null
	}
	return null
}

function calendarDate(value: unknown) {
	const raw = text(value, 10)
	if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
	const [year, month, day] = raw.split('-').map(Number)
	const date = new Date(Date.UTC(year!, month! - 1, day!))
	return date.getUTCFullYear() === year &&
		date.getUTCMonth() === month! - 1 &&
		date.getUTCDate() === day
		? date
		: null
}

function homepage(value: unknown) {
	const raw = text(value, 2_048)
	if (!raw) return null
	try {
		const url = new URL(raw)
		return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
	} catch {
		return null
	}
}

function profileImage(value: unknown) {
	const path = text(value, 300)
	return path && /^\/[A-Za-z0-9._/-]+$/.test(path)
		? `https://image.tmdb.org/t/p/w500${path}`
		: null
}

function gender(value: unknown) {
	return value === 1
		? 'Female'
		: value === 2
			? 'Male'
			: value === 3
				? 'Non-binary'
				: null
}

export function normalizeTmdbPersonDetails(value: unknown, externalId: string) {
	const payload = record(value)
	const id = tmdbId(payload?.id)
	const name = text(payload?.name, 200)
	if (!payload || id !== externalId || !name) {
		throw new Error('TMDB person response did not match the requested person')
	}
	return {
		name,
		normalized: normalizePersonName(name),
		imageUrl: profileImage(payload.profile_path),
		knownForDepartment: text(payload.known_for_department, 100),
		biography: text(payload.biography, 20_000),
		birthday: calendarDate(payload.birthday),
		deathday: calendarDate(payload.deathday),
		placeOfBirth: text(payload.place_of_birth, 500),
		gender: gender(payload.gender),
		homepage: homepage(payload.homepage),
	}
}

export function tmdbPersonDetailUrl(externalId: string) {
	if (!tmdbId(externalId)) throw new Error('TMDB person id is invalid')
	const url = new URL(`https://api.themoviedb.org/3/person/${externalId}`)
	url.searchParams.set('language', 'en-US')
	return url.toString()
}

async function fetchAndStorePersonDetails(
	database: PersonDetailsDatabase,
	person: PersonDetailsRecord,
	externalId: string,
	options: EnrichmentOptions,
) {
	const now = options.now ?? new Date()
	const apiToken = configuredApiToken(options)
	if (!apiToken) return person

	const controller = new AbortController()
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? PERSON_DETAILS_TIMEOUT_MS,
	)
	try {
		const response = await (options.fetchImpl ?? fetch)(
			tmdbPersonDetailUrl(externalId),
			{
				headers: {
					accept: 'application/json',
					Authorization: `Bearer ${apiToken}`,
				},
				signal: controller.signal,
			},
		)
		if (!response.ok) {
			throw new Error(`TMDB person request failed with ${response.status}`)
		}
		const details = normalizeTmdbPersonDetails(
			await response.json(),
			externalId,
		)
		return await database.person.update({
			where: { id: person.id },
			data: { ...details, detailsFetchedAt: now },
			select: personDetailsSelect,
		})
	} catch (error) {
		rememberFailure(
			person.id,
			now.getTime() + PERSON_DETAILS_FAILURE_BACKOFF_MS,
		)
		console.warn(
			`TMDB person enrichment failed for ${person.id}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
		return person
	} finally {
		clearTimeout(timeout)
	}
}

/** Fetch a viewed TMDB person once, then serve the canonical cached record. */
export async function enrichPersonDetails(
	database: PersonDetailsDatabase,
	person: PersonDetailsRecord,
	options: EnrichmentOptions = {},
): Promise<PersonDetailsRecord> {
	const now = options.now ?? new Date()
	if (
		person.detailsFetchedAt &&
		person.detailsFetchedAt.getTime() > now.getTime() - PERSON_DETAILS_FRESH_MS
	) {
		return person
	}
	if (!options.fetchImpl && process.env.VEUD_E2E === '1') return person
	if (!configuredApiToken(options)) return person
	if (failureBackoffActive(person.id, now.getTime())) return person

	const existing = inFlight.get(person.id)
	if (existing) return existing
	const request = (async () => {
		const identity = await database.personExternalId.findFirst({
			where: { personId: person.id, provider: 'tmdb' },
			select: { externalId: true },
			orderBy: { createdAt: 'asc' },
		})
		const externalId = tmdbId(identity?.externalId)
		return externalId
			? fetchAndStorePersonDetails(database, person, externalId, options)
			: person
	})().finally(() => inFlight.delete(person.id))
	inFlight.set(person.id, request)
	return request
}

export function resetPersonDetailsRuntimeStateForTests() {
	inFlight.clear()
	retryAfter.clear()
}
