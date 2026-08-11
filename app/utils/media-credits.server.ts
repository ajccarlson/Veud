import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '@prisma/client'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'

type PrismaTransaction = Prisma.TransactionClient

/**
 * Turning a provider's credits payload into rows.
 *
 * Credits are written during hydration, which only ever runs on titles the
 * catalog has decided are worth fetching — so this grows with hydrated titles,
 * not with the raw inventory. It still needs bounding: a large film credits
 * several hundred people, almost all of them in departments nobody browses to,
 * and multiplying that by the hydrated catalog is the difference between a
 * table and a problem.
 */

export type CreditType = 'cast' | 'crew'

export type CatalogCreditInput = {
	/** The provider's own id for this person. Identity comes from here. */
	externalId: string
	name: string
	imageUrl: string | null
	knownForDepartment: string | null
	creditType: CreditType
	/** Character played, or job done. */
	role: string
	/** Crew grouping. Empty for cast, who are not departmental. */
	department: string
	billingOrder: number | null
	episodeCount: number | null
}

/**
 * How many of each we keep per title.
 *
 * Cast is ordered by billing, so a cap keeps the people the production put
 * first and drops the ones credited as "Party Guest #4". Crew is ordered by the
 * priority below, so a cap keeps the director and drops the second assistant
 * to the accountant.
 */
export const MAX_CAST_PER_TITLE = 25
export const MAX_CREW_PER_TITLE = 20

/** A long character name is a description; nothing renders more than this. */
export const MAX_ROLE_LENGTH = 200

/**
 * The crew jobs worth keeping, most interesting first.
 *
 * Anything not listed is still eligible, just after these — the cap decides
 * what actually survives. This ordering is what makes a truncated crew list
 * useful rather than arbitrary.
 */
export const CREW_JOB_PRIORITY = [
	'Director',
	'Creator',
	'Series Creator',
	'Writer',
	'Screenplay',
	'Story',
	'Novel',
	'Characters',
	'Comic Book',
	'Executive Producer',
	'Producer',
	'Original Music Composer',
	'Music',
	'Director of Photography',
	'Editor',
	'Production Design',
	'Art Direction',
	'Costume Design',
	'Casting',
	'Animation Director',
	'Character Designer',
	'Sound Designer',
]

const CREW_JOB_RANK = new Map(
	CREW_JOB_PRIORITY.map((job, index) => [job.toLowerCase(), index]),
)

function crewRank(job: string) {
	return CREW_JOB_RANK.get(job.trim().toLowerCase()) ?? CREW_JOB_PRIORITY.length
}

/**
 * The jobs shown beneath the overview, as TMDB does it.
 *
 * Deliberately short. The point of this line is to answer "whose is this?"
 * without becoming the full crew list that already has its own page.
 */
export const KEY_CREW_JOBS = [
	'Director',
	'Creator',
	'Series Creator',
	'Writer',
	'Screenplay',
	'Story',
	'Characters',
	'Novel',
	'Comic Book',
]

const KEY_CREW_SET = new Set(KEY_CREW_JOBS.map(job => job.toLowerCase()))

export function isKeyCrewJob(job: string) {
	return KEY_CREW_SET.has(job.trim().toLowerCase())
}

/** Names arrive with stray whitespace often enough to be worth one pass. */
export function cleanName(value: unknown) {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function cleanRole(value: unknown) {
	return cleanName(value).slice(0, MAX_ROLE_LENGTH)
}

/**
 * A person's name reduced to something comparable.
 *
 * The same fold titles get, so a name and a title match by the same rules —
 * "Bong Joon-ho" and "Bong Joon Ho" have to be one search result, and the
 * accents in "Léa Seydoux" cannot be the reason a search misses her.
 *
 * Only ever used for searching, never for identity: two people share a name
 * often enough that matching on it would merge them.
 */
export function normalizePersonName(value: string) {
	return normalizeCatalogTitle(cleanName(value))
}

/** TMDB gives a path on its own image CDN, or null. */
export function tmdbProfileUrl(profilePath: unknown) {
	return typeof profilePath === 'string' && profilePath.startsWith('/')
		? `https://image.tmdb.org/t/p/w185${profilePath}`
		: null
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter(
				(entry): entry is Record<string, unknown> =>
					Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
			)
		: []
}

function providerId(value: unknown) {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
		return String(value)
	}
	if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
		return value.trim()
	}
	return null
}

function optionalCount(value: unknown) {
	return typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value < 1_000_000
		? value
		: null
}

/**
 * Cast and crew from a TMDB detail payload.
 *
 * Films carry `credits`; series carry `aggregate_credits`, where a person holds
 * `roles` rather than one character because they may have played several across
 * seasons — and an `episode_count`, which is the honest measure of how much of
 * a series someone was actually in.
 */
export function normalizeTmdbCredits(payload: unknown): CatalogCreditInput[] {
	if (!payload || typeof payload !== 'object') return []
	const record = payload as Record<string, unknown>
	const container =
		(record.aggregate_credits as Record<string, unknown> | undefined) ??
		(record.credits as Record<string, unknown> | undefined)
	if (!container || typeof container !== 'object') return []

	const cast: CatalogCreditInput[] = []
	for (const entry of asRecordArray(container.cast)) {
		const externalId = providerId(entry.id)
		const name = cleanName(entry.name)
		if (!externalId || !name) continue

		// A series aggregates a person's roles across seasons; a film has one.
		const roles = asRecordArray(entry.roles)
		const parts = roles.length
			? roles.map(role => ({
					role: cleanRole(role.character),
					episodeCount: optionalCount(role.episode_count),
				}))
			: [{ role: cleanRole(entry.character), episodeCount: null }]

		const shared = {
			externalId,
			name,
			imageUrl: tmdbProfileUrl(entry.profile_path),
			knownForDepartment: cleanName(entry.known_for_department) || null,
			creditType: 'cast' as const,
			department: '',
			billingOrder: optionalCount(entry.order),
		}
		for (const part of parts) {
			cast.push({
				...shared,
				role: part.role,
				episodeCount:
					part.episodeCount ?? optionalCount(entry.total_episode_count),
			})
		}
	}

	const crew: CatalogCreditInput[] = []
	for (const entry of asRecordArray(container.crew)) {
		const externalId = providerId(entry.id)
		const name = cleanName(entry.name)
		if (!externalId || !name) continue

		// Series crew aggregate the same way cast do.
		const jobs = asRecordArray(entry.jobs)
		const parts = jobs.length
			? jobs.map(job => ({
					role: cleanRole(job.job),
					episodeCount: optionalCount(job.episode_count),
				}))
			: [{ role: cleanRole(entry.job), episodeCount: null }]

		const shared = {
			externalId,
			name,
			imageUrl: tmdbProfileUrl(entry.profile_path),
			knownForDepartment: cleanName(entry.known_for_department) || null,
			creditType: 'crew' as const,
			department: cleanName(entry.department),
			billingOrder: null,
		}
		for (const part of parts) {
			if (!part.role) continue
			crew.push({
				...shared,
				role: part.role,
				episodeCount:
					part.episodeCount ?? optionalCount(entry.total_episode_count),
			})
		}
	}

	return [...boundCast(cast), ...boundCrew(crew)]
}

/**
 * Keep the top of the billing, in billing order.
 *
 * Entries with no order sort last: a provider that gave no order gave no claim
 * about prominence, and guessing one would put an extra behind a lead.
 */
export function boundCast(
	cast: CatalogCreditInput[],
	limit = MAX_CAST_PER_TITLE,
) {
	return [...cast]
		.sort(
			(first, second) =>
				(first.billingOrder ?? Number.MAX_SAFE_INTEGER) -
				(second.billingOrder ?? Number.MAX_SAFE_INTEGER),
		)
		.slice(0, limit)
}

/** Keep the crew people look for, by the priority above. */
export function boundCrew(
	crew: CatalogCreditInput[],
	limit = MAX_CREW_PER_TITLE,
) {
	return [...crew]
		.sort((first, second) => {
			const byJob = crewRank(first.role) - crewRank(second.role)
			if (byJob !== 0) return byJob
			// Stable enough to be reproducible across refreshes, so an unchanged
			// payload does not rewrite the same rows in a different order.
			return first.name.localeCompare(second.name)
		})
		.slice(0, limit)
}

/**
 * Collapse credits that would collide in the database.
 *
 * The uniqueness is (media, person, type, role, department), and a payload can
 * repeat one — a person credited twice for the same job on the same title
 * happens. Keeping the first occurrence preserves the ordering decided above.
 */
export function dedupeCredits(credits: CatalogCreditInput[]) {
	const seen = new Set<string>()
	const unique: CatalogCreditInput[] = []
	for (const credit of credits) {
		const key = [
			credit.externalId,
			credit.creditType,
			credit.role,
			credit.department,
		].join(' ')
		if (seen.has(key)) continue
		seen.add(key)
		unique.push(credit)
	}
	return unique
}

/**
 * Replace one provider's credits for one title.
 *
 * Delete-then-write, scoped by provider, exactly as titles are replaced: a
 * refresh is the provider restating what it knows, so a credit it no longer
 * lists should stop existing rather than linger. Scoping by provider keeps MAL
 * from deleting what TMDB wrote about the same title.
 *
 * People are resolved in bulk rather than one upsert each. A film carries forty
 * of them, and forty round trips inside the hydration transaction — per title,
 * for every title in a batch — is how a transaction becomes a lock.
 */
export async function replaceCatalogCredits(
	tx: PrismaTransaction,
	input: {
		mediaId: string
		provider: string
		credits: CatalogCreditInput[]
		catalogProvenanceVersion?: number
		now?: Date
	},
) {
	const provider = input.provider.trim()
	if (!provider) throw new Error('replaceCatalogCredits requires a provider')
	const now = input.now ?? new Date()
	const credits = dedupeCredits(input.credits)

	// Always clear, even when the payload is empty: a title whose credits were
	// withdrawn should lose them.
	await tx.mediaCredit.deleteMany({
		where: { mediaId: input.mediaId, provider },
	})
	if (!credits.length) return { people: 0, credits: 0 }

	const personIdByExternalId = await resolvePeople(tx, provider, credits, now)

	await tx.mediaCredit.createMany({
		data: credits.flatMap(credit => {
			const personId = personIdByExternalId.get(credit.externalId)
			if (!personId) return []
			return [
				{
					id: createId(),
					mediaId: input.mediaId,
					personId,
					provider,
					creditType: credit.creditType,
					role: credit.role,
					department: credit.department,
					billingOrder: credit.billingOrder,
					episodeCount: credit.episodeCount,
					catalogProvenanceVersion: input.catalogProvenanceVersion ?? 0,
					updatedAt: now,
				},
			]
		}),
	})

	return { people: personIdByExternalId.size, credits: credits.length }
}

/**
 * Person ids for every external id in this payload, creating the ones that are
 * new.
 *
 * Three queries regardless of how many people a title credits.
 */
async function resolvePeople(
	tx: PrismaTransaction,
	provider: string,
	credits: CatalogCreditInput[],
	now: Date,
) {
	// One entry per person: a person credited twice on one title is still one
	// person, and the first mention carries as good a name and portrait as the
	// second.
	const byExternalId = new Map<string, CatalogCreditInput>()
	for (const credit of credits) {
		if (!byExternalId.has(credit.externalId)) {
			byExternalId.set(credit.externalId, credit)
		}
	}

	const existing = await tx.personExternalId.findMany({
		where: { provider, externalId: { in: [...byExternalId.keys()] } },
		select: { externalId: true, personId: true },
	})
	const personIdByExternalId = new Map(
		existing.map(row => [row.externalId, row.personId]),
	)

	const missing = [...byExternalId.values()].filter(
		credit => !personIdByExternalId.has(credit.externalId),
	)
	if (missing.length) {
		const created = missing.map(credit => ({
			id: createId(),
			credit,
		}))
		await tx.person.createMany({
			data: created.map(({ id, credit }) => ({
				id,
				name: credit.name,
				normalized: normalizePersonName(credit.name),
				imageUrl: credit.imageUrl,
				knownForDepartment: credit.knownForDepartment,
				updatedAt: now,
			})),
		})
		await tx.personExternalId.createMany({
			data: created.map(({ id, credit }) => ({
				id: createId(),
				provider,
				externalId: credit.externalId,
				personId: id,
				updatedAt: now,
			})),
		})
		for (const { id, credit } of created) {
			personIdByExternalId.set(credit.externalId, id)
		}
	}

	// A portrait appears after the fact more often than a name changes, and a
	// person page with no picture is the visible cost of never looking again.
	// Only the people who are actually stale are written.
	const stale = await tx.person.findMany({
		where: {
			id: { in: [...personIdByExternalId.values()] },
			imageUrl: null,
		},
		select: { id: true },
	})
	const externalIdByPersonId = new Map(
		[...personIdByExternalId].map(([externalId, personId]) => [
			personId,
			externalId,
		]),
	)
	for (const person of stale) {
		const credit = byExternalId.get(externalIdByPersonId.get(person.id) ?? '')
		if (!credit?.imageUrl) continue
		await tx.person.update({
			where: { id: person.id },
			data: { imageUrl: credit.imageUrl, updatedAt: now },
		})
	}

	return personIdByExternalId
}

/**
 * Manga authors from a MAL detail payload.
 *
 * MAL's official API has no cast — no voice actors, no characters — but it does
 * name the people who made a manga, with their own person ids. Those are real
 * credits and belong in the same table as everyone else, so a mangaka's page
 * works exactly like a director's.
 *
 * The role MAL gives ("Story", "Art", "Story & Art") is the job, which puts a
 * mangaka in the same shape as a screenwriter.
 */
export function normalizeMalAuthorCredits(payload: unknown): CatalogCreditInput[] {
	if (!payload || typeof payload !== 'object') return []
	const authors = asRecordArray((payload as Record<string, unknown>).authors)

	const credits: CatalogCreditInput[] = []
	for (const entry of authors) {
		const node =
			entry.node && typeof entry.node === 'object'
				? (entry.node as Record<string, unknown>)
				: entry
		const externalId = providerId(node.id)
		// MAL splits the name in two, and either half can be missing.
		const name = cleanName(
			[node.first_name, node.last_name]
				.map(part => cleanName(part))
				.filter(Boolean)
				.join(' '),
		)
		if (!externalId || !name) continue
		credits.push({
			externalId,
			name,
			// The MAL people endpoint carries a portrait; the manga payload does
			// not, so this stays empty until something else fills it.
			imageUrl: null,
			knownForDepartment: 'Writing',
			creditType: 'crew',
			role: cleanRole(entry.role) || 'Author',
			department: 'Writing',
			billingOrder: null,
			episodeCount: null,
		})
	}
	return boundCrew(credits)
}
