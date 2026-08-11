import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '@prisma/client'
import { normalizeCatalogTitle } from './catalog-sync.server.ts'
import { splitLegacyThumbnail } from './media-detail.ts'

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
export function normalizeMalAuthorCredits(
	payload: unknown,
): CatalogCreditInput[] {
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

// --- reading ---------------------------------------------------------------

/**
 * How many faces the billed strip shows before the rest moves to its own page.
 *
 * TMDB shows about this many and then a "View More" card, which is the right
 * shape: enough to recognise the title by its cast, not so many that the strip
 * becomes the page.
 */
export const TOP_BILLED_CAST = 10

/** Everything a cast or crew card needs, and nothing a page has to look up. */
const creditCardSelect = {
	id: true,
	role: true,
	department: true,
	billingOrder: true,
	episodeCount: true,
	creditType: true,
	person: {
		select: { id: true, name: true, imageUrl: true, knownForDepartment: true },
	},
} as const

export type MediaCreditCard = {
	id: string
	role: string
	department: string
	episodeCount: number | null
	person: {
		id: string
		name: string
		imageUrl: string | null
		knownForDepartment: string | null
	}
}

type CreditRow = {
	id: string
	role: string
	department: string
	billingOrder: number | null
	episodeCount: number | null
	creditType: string
	person: {
		id: string
		name: string
		imageUrl: string | null
		knownForDepartment: string | null
	}
}

function toCard(row: CreditRow): MediaCreditCard {
	return {
		id: row.id,
		role: row.role,
		department: row.department,
		episodeCount: row.episodeCount,
		person: row.person,
	}
}

/**
 * The billed strip and the line of key crew beneath the overview.
 *
 * Both come from one query because they are one section of one page, and the
 * media loader already runs enough of them.
 */
export async function getMediaCreditsPreview(
	tx: PrismaTransaction,
	mediaId: string,
	{ topBilled = TOP_BILLED_CAST }: { topBilled?: number } = {},
) {
	// One query, not three. Ingestion caps what can be stored per provider, so
	// the whole credit list for a title is a few dozen rows — cheaper to fetch
	// once and divide here than to ask the database three times. The media
	// detail loader runs on the busiest page on the site and has a query budget
	// for exactly this reason.
	const rows = await tx.mediaCredit.findMany({
		where: { mediaId },
		// Nulls last: a provider that gave no billing made no claim about
		// prominence, and letting one sort to the front would put an extra ahead
		// of the lead.
		orderBy: [{ billingOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
		select: creditCardSelect,
	})

	const cast = rows.filter(row => row.creditType === 'cast')
	const crew = rows.filter(row => row.creditType === 'crew')

	return {
		cast: cast.slice(0, topBilled).map(toCard),
		// One line answering "whose is this?", not the crew list that has its own
		// page. A person who both wrote and directed appears once, under the job
		// that says more.
		keyCrew: dedupeByPerson(
			crew
				.filter(row => isKeyCrewJob(row.role))
				.sort((first, second) => crewRank(first.role) - crewRank(second.role)),
		).map(toCard),
		castTotal: cast.length,
		crewTotal: crew.length,
	}
}

function dedupeByPerson(rows: CreditRow[]) {
	const seen = new Set<string>()
	return rows.filter(row => {
		if (seen.has(row.person.id)) return false
		seen.add(row.person.id)
		return true
	})
}

export type CrewDepartment = {
	department: string
	credits: MediaCreditCard[]
}

/**
 * Everything, for the full cast and crew page.
 *
 * Crew is grouped by department the way a call sheet is, because a crew list
 * ordered by anything else is unreadable — you look for the department first
 * and the person second.
 */
export async function getMediaFullCredits(
	tx: PrismaTransaction,
	mediaId: string,
) {
	const rows = await tx.mediaCredit.findMany({
		where: { mediaId },
		orderBy: [{ billingOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
		select: creditCardSelect,
	})

	const cast = rows.filter(row => row.creditType === 'cast').map(toCard)
	const byDepartment = new Map<string, MediaCreditCard[]>()
	for (const row of rows) {
		if (row.creditType !== 'crew') continue
		// A provider that named no department still named a job; filing those
		// under "Crew" keeps them on the page instead of in a heading with no
		// name.
		const department = row.department || 'Crew'
		byDepartment.set(department, [
			...(byDepartment.get(department) ?? []),
			toCard(row),
		])
	}

	const crew: CrewDepartment[] = [...byDepartment.entries()]
		.map(([department, credits]) => ({
			department,
			credits: credits.sort(
				(first, second) =>
					crewRank(first.role) - crewRank(second.role) ||
					first.person.name.localeCompare(second.person.name),
			),
		}))
		// Departments in the order their most senior job ranks, so Directing leads
		// and the long tail follows.
		.sort(
			(first, second) =>
				crewRank(first.credits[0]?.role ?? '') -
					crewRank(second.credits[0]?.role ?? '') ||
				first.department.localeCompare(second.department),
		)

	return { cast, crew }
}

// --- one person ------------------------------------------------------------

/** Titles per department on a person page, newest first. */
export const MAX_PERSON_CREDITS = 200

/** The strip at the top of a person page. */
export const KNOWN_FOR_COUNT = 8

export type PersonCredit = {
	id: string
	role: string
	department: string
	creditType: string
	episodeCount: number | null
	year: string | null
	media: {
		id: string
		kind: string
		title: string
		imageUrl: string | null
	}
}

function creditYear(releaseStart: Date | null, startYear: string | null) {
	if (releaseStart) return String(releaseStart.getUTCFullYear())
	return startYear?.trim() || null
}

/**
 * Everything one person is credited on, which is the question a person page
 * exists to answer.
 *
 * Grouped the way TMDB groups it — acting first if that is what they are known
 * for, then each crew department — and sorted newest first inside each group,
 * because a filmography is read backwards from now.
 */
export async function getPersonCredits(
	tx: PrismaTransaction,
	personId: string,
	{ limit = MAX_PERSON_CREDITS }: { limit?: number } = {},
) {
	const rows = await tx.mediaCredit.findMany({
		where: { personId },
		orderBy: [{ id: 'asc' }],
		take: limit,
		select: {
			id: true,
			role: true,
			department: true,
			creditType: true,
			episodeCount: true,
			media: {
				select: {
					id: true,
					kind: true,
					title: true,
					thumbnail: true,
					releaseStart: true,
					startYear: true,
					catalogPopularity: true,
				},
			},
		},
	})

	const credits: Array<PersonCredit & { popularity: number | null }> = rows.map(
		row => ({
			id: row.id,
			role: row.role,
			department: row.department,
			creditType: row.creditType,
			episodeCount: row.episodeCount,
			year: creditYear(row.media.releaseStart, row.media.startYear),
			popularity: row.media.catalogPopularity,
			media: {
				id: row.media.id,
				kind: row.media.kind,
				title: row.media.title?.trim() || `Untitled ${row.media.kind}`,
				imageUrl: splitLegacyThumbnail(row.media.thumbnail).imageUrl,
			},
		}),
	)

	// The strip is what this person is recognised for, so it is ordered by how
	// well known the title is rather than by when it came out. One entry per
	// title: someone who wrote and directed a film is not two of its cards.
	const seenMedia = new Set<string>()
	const knownFor = [...credits]
		.sort(
			(first, second) => (second.popularity ?? -1) - (first.popularity ?? -1),
		)
		.filter(credit => {
			if (seenMedia.has(credit.media.id)) return false
			seenMedia.add(credit.media.id)
			return true
		})
		.slice(0, KNOWN_FOR_COUNT)
		.map(stripPopularity)

	const groups = new Map<string, PersonCredit[]>()
	for (const credit of credits) {
		const group =
			credit.creditType === 'cast' ? 'Acting' : credit.department || 'Crew'
		groups.set(group, [...(groups.get(group) ?? []), stripPopularity(credit)])
	}

	const filmography = [...groups.entries()]
		.map(([department, entries]) => ({
			department,
			// A filmography is read backwards from now. Undated work sorts last:
			// it is usually unreleased or unknown, and either way it is not the
			// thing to lead with.
			credits: entries.sort(
				(first, second) =>
					(second.year ?? '').localeCompare(first.year ?? '') ||
					first.media.title.localeCompare(second.media.title),
			),
			department_count: entries.length,
		}))
		.sort(
			(first, second) =>
				// Acting leads for an actor; otherwise the biggest body of work does.
				second.credits.length - first.credits.length ||
				first.department.localeCompare(second.department),
		)

	return { knownFor, filmography, total: credits.length }
}

function stripPopularity(
	credit: PersonCredit & { popularity: number | null },
): PersonCredit {
	const { popularity: _popularity, ...rest } = credit
	return rest
}
