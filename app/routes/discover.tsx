import {
	data as json,
	Form,
	Link,
	redirect,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useActionData,
	useFetcher,
	useLoaderData,
	useLocation,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { QuickTrackControl } from '#app/components/quick-track-control.tsx'
import { RecommendationLanes } from '#app/components/recommendation-lanes.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
} from '#app/components/ui/veud-layout.tsx'
import { type action as imageTipOfTongueAction } from '#app/routes/resources+/image-tip-of-tongue.ts'
import { isAiCapabilityConfigured } from '#app/utils/ai-gateway.server.ts'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	getDiscoveryGenres,
	getDiscoveryResults,
	getDiscoveryResultsForMediaIds,
	getDiscoveryResultsForPlan,
	getDiscoveryStatuses,
	parseDiscoveryQuery,
	type DiscoveryQuery,
} from '#app/utils/discovery.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import {
	createNaturalLanguageDiscoveryPlan,
	naturalDiscoveryFallbackReason,
	refineNaturalLanguageDiscoveryPlan,
} from '#app/utils/natural-language-discovery.server.ts'
import {
	discoveryPlanChips,
	NaturalLanguageDiscoveryPlanSchema,
	type NaturalLanguageDiscoveryPlan,
} from '#app/utils/natural-language-discovery.ts'
import { getRecommendationGraph } from '#app/utils/recommendation-graph.server.ts'
import { getTipOfTongueMatches } from '#app/utils/tip-of-tongue.server.ts'
import '#app/styles/discover.scss'

const kindLabels: Record<DiscoveryQuery['kind'], string> = {
	all: 'All media',
	movie: 'Movies',
	tv: 'TV',
	anime: 'Anime',
	manga: 'Manga',
}

const sortLabels: Record<DiscoveryQuery['sort'], string> = {
	popular: 'Popular',
	'top-rated': 'Top rated',
	newest: 'Recently added',
	title: 'Title A–Z',
	'for-you': 'For you',
}

const providerLabels: Record<DiscoveryQuery['provider'], string> = {
	all: 'All providers',
	tmdb: 'TMDB',
	mal: 'MyAnimeList',
}

const DiscoveryActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('describe-start'),
		q: z.string().trim().min(3).max(500),
		kind: z.enum(['all', 'movie', 'tv', 'anime', 'manga']),
	}),
	z.object({
		intent: z.literal('describe-refine'),
		sessionId: z.string().min(1).max(100),
		refinement: z.string().trim().min(1).max(500),
	}),
	z.object({
		intent: z.literal('describe-undo'),
		sessionId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('describe-remove'),
		sessionId: z.string().min(1).max(100),
		chipType: z.string().min(1).max(40),
		chipValue: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('describe-relax'),
		sessionId: z.string().min(1).max(100),
	}),
])

const DISCOVERY_SESSION_MS = 2 * 60 * 60 * 1_000

function parseSessionValues(value: string) {
	const parsed: unknown = JSON.parse(value)
	if (!Array.isArray(parsed)) throw new Error('Invalid discovery session')
	return parsed
}

function removeDiscoveryChip(
	plan: NaturalLanguageDiscoveryPlan,
	type: string,
	value: string,
) {
	const next = structuredClone(plan)
	if (type === 'kind' && next.kinds.length > 1) {
		next.kinds = next.kinds.filter(item => item !== value)
	} else if (type === 'genre') {
		next.includeGenres = next.includeGenres.filter(item => item !== value)
	} else if (type === 'excluded genre') {
		next.excludeGenres = next.excludeGenres.filter(item => item !== value)
	} else if (type === 'concept') {
		next.includeTerms = next.includeTerms.filter(item => item !== value)
	} else if (type === 'excluded concept') {
		next.excludeTerms = next.excludeTerms.filter(item => item !== value)
	} else if (type === 'years') {
		next.yearFrom = null
		next.yearTo = null
	} else if (type === 'status') {
		next.releaseStatus = null
	} else if (type === 'language') {
		next.language = null
	} else if (type === 'tone') {
		next.toneTerms = next.toneTerms.filter(item => item !== value)
	} else if (type === 'pace') {
		next.pace = null
	} else if (['minutes', 'episodes', 'chapters', 'volumes'].includes(type)) {
		next.lengthUnit = null
		next.lengthFrom = null
		next.lengthTo = null
	} else if (type === 'sort') {
		next.sort = 'popular'
	}
	next.explanation = 'Refined discovery filters.'
	return NaturalLanguageDiscoveryPlanSchema.parse(next)
}

function relaxDiscoveryPlan(plan: NaturalLanguageDiscoveryPlan) {
	const chips = discoveryPlanChips(plan).filter(chip => chip.type !== 'kind')
	const preferredOrder = [
		'concept',
		'tone',
		'pace',
		'genre',
		'years',
		'minutes',
		'episodes',
		'chapters',
		'volumes',
		'excluded concept',
		'excluded genre',
	]
	const chip = preferredOrder.flatMap(type =>
		chips.filter(candidate => candidate.type === type),
	)[0]
	return chip ? removeDiscoveryChip(plan, chip.type, chip.value) : plan
}

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const parsed = DiscoveryActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		throw new Response('Invalid discovery assistant action', { status: 400 })
	}
	const now = new Date()
	if (parsed.data.intent === 'describe-start') {
		const plan = await createNaturalLanguageDiscoveryPlan(
			{ memberRequest: parsed.data.q, kind: parsed.data.kind },
			{ rateLimitKey: `viewer:${ownerId}` },
		).catch(error => {
			throw new Response(
				`Discovery assistant unavailable: ${naturalDiscoveryFallbackReason(error)}`,
				{ status: 503 },
			)
		})
		const session = await prisma.aiDiscoverySession.create({
			data: {
				ownerId,
				phrases: JSON.stringify([parsed.data.q]),
				plans: JSON.stringify([plan]),
				expiresAt: new Date(now.getTime() + DISCOVERY_SESSION_MS),
			},
			select: { id: true },
		})
		throw redirect(`/discover?mode=describe&session=${session.id}`)
	}
	const session = await prisma.aiDiscoverySession.findFirst({
		where: {
			id: parsed.data.sessionId,
			ownerId,
			expiresAt: { gt: now },
		},
	})
	if (!session) throw new Response('Discovery session expired', { status: 404 })
	const phrases = z
		.array(z.string().max(500))
		.parse(parseSessionValues(session.phrases))
	const plans = z
		.array(NaturalLanguageDiscoveryPlanSchema)
		.parse(parseSessionValues(session.plans))
	if (parsed.data.intent === 'describe-undo') {
		await prisma.aiDiscoverySession.update({
			where: { id: session.id },
			data: {
				currentStep: Math.max(0, session.currentStep - 1),
				expiresAt: new Date(now.getTime() + DISCOVERY_SESSION_MS),
			},
		})
		throw redirect(`/discover?mode=describe&session=${session.id}`)
	}
	const currentPlan = plans[session.currentStep]
	if (!currentPlan)
		throw new Response('Discovery session is invalid', { status: 409 })
	if (
		parsed.data.intent === 'describe-remove' ||
		parsed.data.intent === 'describe-relax'
	) {
		const nextPlan =
			parsed.data.intent === 'describe-remove'
				? removeDiscoveryChip(
						currentPlan,
						parsed.data.chipType,
						parsed.data.chipValue,
					)
				: relaxDiscoveryPlan(currentPlan)
		if (JSON.stringify(nextPlan) === JSON.stringify(currentPlan)) {
			throw new Response('That constraint cannot be relaxed safely.', {
				status: 409,
			})
		}
		const phrase =
			parsed.data.intent === 'describe-remove'
				? `Removed ${parsed.data.chipType}: ${parsed.data.chipValue}`
				: 'Relaxed one constraint'
		const nextPhrases = [...phrases.slice(0, session.currentStep + 1), phrase]
		const nextPlans = [...plans.slice(0, session.currentStep + 1), nextPlan]
		await prisma.aiDiscoverySession.update({
			where: { id: session.id },
			data: {
				phrases: JSON.stringify(nextPhrases),
				plans: JSON.stringify(nextPlans),
				currentStep: nextPlans.length - 1,
				expiresAt: new Date(now.getTime() + DISCOVERY_SESSION_MS),
			},
		})
		throw redirect(`/discover?mode=describe&session=${session.id}`)
	}
	const nextPhrase = parsed.data.refinement
	const nextPlan = await refineNaturalLanguageDiscoveryPlan(
		{
			memberPhrases: [...phrases.slice(0, session.currentStep + 1), nextPhrase],
			currentPlan,
			newRequest: nextPhrase,
		},
		{ rateLimitKey: `viewer:${ownerId}` },
	).catch(() => null as null | NaturalLanguageDiscoveryPlan)
	if (!nextPlan) {
		return json(
			{
				ok: false as const,
				error:
					'Refinement is temporarily unavailable. Your last valid filters and results are unchanged.',
			},
			{ status: 503 },
		)
	}
	const nextPhrases = [...phrases.slice(0, session.currentStep + 1), nextPhrase]
	const nextPlans = [...plans.slice(0, session.currentStep + 1), nextPlan]
	await prisma.aiDiscoverySession.update({
		where: { id: session.id },
		data: {
			phrases: JSON.stringify(nextPhrases),
			plans: JSON.stringify(nextPlans),
			currentStep: nextPlans.length - 1,
			expiresAt: new Date(now.getTime() + DISCOVERY_SESSION_MS),
		},
	})
	throw redirect(`/discover?mode=describe&session=${session.id}`)
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	if (viewerId) {
		await prisma.aiDiscoverySession.deleteMany({
			where: { ownerId: viewerId, expiresAt: { lte: new Date() } },
		})
	}
	const searchParams = new URL(request.url).searchParams
	const filters = parseDiscoveryQuery(searchParams)
	const requestedSessionId = searchParams.get('session')
	const discoverySession =
		viewerId && filters.mode === 'describe' && requestedSessionId
			? await prisma.aiDiscoverySession.findFirst({
					where: {
						id: requestedSessionId,
						ownerId: viewerId,
						expiresAt: { gt: new Date() },
					},
				})
			: null
	const sessionPhrases = discoverySession
		? z
				.array(z.string().max(500))
				.parse(parseSessionValues(discoverySession.phrases))
		: []
	const sessionPlans = discoverySession
		? z
				.array(NaturalLanguageDiscoveryPlanSchema)
				.parse(parseSessionValues(discoverySession.plans))
		: []
	const naturalPlan = discoverySession
		? (sessionPlans[discoverySession.currentStep] ?? null)
		: null
	const previousNaturalPlan =
		discoverySession && discoverySession.currentStep > 0
			? (sessionPlans[discoverySession.currentStep - 1] ?? null)
			: null
	const recommendationGraphPromise =
		viewerId &&
		filters.mode === 'standard' &&
		!filters.q &&
		filters.kind === 'all' &&
		!filters.genre &&
		filters.year === null &&
		!filters.status &&
		filters.provider === 'all' &&
		filters.sort === 'for-you' &&
		filters.page === 1
			? getRecommendationGraph(viewerId)
			: Promise.resolve(null)
	const memoryQueryTooShort = filters.mode === 'memory' && filters.q.length < 3
	const genresPromise = getDiscoveryGenres()
	const statusesPromise = getDiscoveryStatuses()
	const watchlistsPromise = viewerId
		? prisma.watchlist.findMany({
				where: { ownerId: viewerId },
				select: {
					id: true,
					name: true,
					header: true,
					position: true,
					type: { select: { name: true } },
				},
				orderBy: [{ position: 'asc' }, { header: 'asc' }],
			})
		: Promise.resolve([])
	const memorySearch =
		filters.mode === 'memory' && !memoryQueryTooShort
			? await getTipOfTongueMatches(
					{
						memory: filters.q,
						kind: filters.kind,
					},
					{
						allowAi: Boolean(viewerId),
						rateLimitKey: viewerId ? `viewer:${viewerId}` : undefined,
					},
				)
			: filters.mode === 'memory'
				? {
						matches: [],
						source: 'catalog-match' as const,
						fallbackReason: null,
					}
				: null
	const [
		discovery,
		genres,
		statuses,
		watchlists,
		recommendationGraph,
		previousNaturalResults,
	] = await Promise.all([
		naturalPlan
			? getDiscoveryResultsForPlan(naturalPlan, viewerId, {
					page: filters.page,
					filters,
				})
			: memorySearch
				? getDiscoveryResultsForMediaIds(
						filters,
						viewerId,
						memorySearch.matches.map(match => match.mediaId),
					)
				: getDiscoveryResults(filters, viewerId),
		genresPromise,
		statusesPromise,
		watchlistsPromise,
		recommendationGraphPromise,
		previousNaturalPlan
			? getDiscoveryResultsForPlan(previousNaturalPlan, viewerId, {
					page: 1,
					filters,
				})
			: Promise.resolve(null),
	])
	if (memorySearch) {
		const matchByMediaId = new Map(
			memorySearch.matches.map(match => [match.mediaId, match]),
		)
		for (const item of discovery.items) {
			const match = matchByMediaId.get(item.id)
			if (match) {
				item.memoryMatch = {
					summary: match.summary,
					matchedClues: match.matchedClues,
				}
			}
		}
	}
	return json({
		...discovery,
		memorySearchSource: memorySearch?.source ?? null,
		memorySearchFallbackReason: memorySearch?.fallbackReason ?? null,
		memoryQueryTooShort,
		aiSearchAvailable: Boolean(
			viewerId && isAiCapabilityConfigured('tip-of-tongue'),
		),
		naturalDiscoveryAvailable: Boolean(
			viewerId && isAiCapabilityConfigured('natural-language-discovery'),
		),
		imageSearchAvailable: Boolean(
			viewerId && isAiCapabilityConfigured('image-tip-of-tongue'),
		),
		genres,
		statuses,
		watchlists,
		recommendationGraph,
		isSignedIn: Boolean(viewerId),
		naturalPlan,
		naturalPlanChips: naturalPlan ? discoveryPlanChips(naturalPlan) : [],
		discoverySession: discoverySession
			? {
					id: discoverySession.id,
					currentStep: discoverySession.currentStep,
					phrases: sessionPhrases,
				}
			: null,
		previousNaturalTotal: previousNaturalResults?.total ?? null,
	})
}

function memorySearchStatus(data: {
	memorySearchSource: 'ai' | 'catalog-match' | null
	memorySearchFallbackReason:
		| 'not-configured'
		| 'sign-in-required'
		| 'rate-limited'
		| 'ai-unavailable'
		| 'ai-error'
		| 'ai-empty'
		| null
}) {
	if (data.memorySearchSource === 'ai') return 'AI match'
	switch (data.memorySearchFallbackReason) {
		case 'sign-in-required':
			return 'Local match · sign in for AI'
		case 'rate-limited':
			return 'Local match · AI limit reached'
		case 'ai-unavailable':
			return 'Local match · AI unavailable'
		case 'ai-error':
			return 'Local match · AI unavailable'
		case 'ai-empty':
			return 'Local match'
		case 'not-configured':
			return 'Local match'
		default:
			return 'Local match'
	}
}

function discoveryHref(
	filters: DiscoveryQuery,
	page: number,
	sessionId?: string | null,
) {
	const searchParams = new URLSearchParams()
	if (filters.q) searchParams.set('q', filters.q)
	if (filters.kind !== 'all') searchParams.set('kind', filters.kind)
	if (filters.mode !== 'standard') searchParams.set('mode', filters.mode)
	if (filters.genre) searchParams.set('genre', filters.genre)
	if (filters.year !== null) searchParams.set('year', String(filters.year))
	if (filters.status) searchParams.set('status', filters.status)
	if (filters.provider !== 'all') searchParams.set('provider', filters.provider)
	if (filters.sort !== 'popular') searchParams.set('sort', filters.sort)
	if (page > 1) searchParams.set('page', String(page))
	if (sessionId) searchParams.set('session', sessionId)
	const search = searchParams.toString()
	return search ? `/discover?${search}` : '/discover'
}

function resultSummary(total: number, filters: DiscoveryQuery) {
	const noun = total === 1 ? 'title' : 'titles'
	if (filters.q) return `${total} ${noun} matching “${filters.q}”`
	return `${total} ${noun}`
}

function HighlightedMemorySummary({
	summary,
	clues,
}: {
	summary: string
	clues: string[]
}) {
	const highlightableClues = [...new Set(clues.map(clue => clue.trim()))]
		.filter(clue =>
			summary.toLocaleLowerCase().includes(clue.toLocaleLowerCase()),
		)
		.sort((left, right) => right.length - left.length)
	if (!highlightableClues.length) return <p>{summary}</p>
	const escapedClues = highlightableClues.map(clue =>
		clue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
	)
	const parts = summary.split(new RegExp(`(${escapedClues.join('|')})`, 'gi'))
	const normalizedClues = new Set(
		highlightableClues.map(clue => clue.toLocaleLowerCase()),
	)
	return (
		<p>
			{parts.map((part, index) =>
				normalizedClues.has(part.toLocaleLowerCase()) ? (
					<mark
						key={`${part}-${index}`}
						className="rounded-sm bg-[#ffffb1] px-0.5 font-semibold text-[#211f24]"
					>
						{part}
					</mark>
				) : (
					part
				),
			)}
		</p>
	)
}

export default function DiscoverRoute() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const location = useLocation()
	const navigation = useNavigation()
	const imageFetcher = useFetcher<typeof imageTipOfTongueAction>()
	const pendingSearchParams = navigation.location
		? new URLSearchParams(navigation.location.search)
		: null
	const navigationMemorySearchPending =
		navigation.state !== 'idle' &&
		(navigation.formData?.get('mode') === 'memory' ||
			pendingSearchParams?.get('mode') === 'memory')
	const describePending =
		navigation.state !== 'idle' &&
		String(navigation.formData?.get('intent') ?? '').startsWith('describe-')
	const imageSearchPending = imageFetcher.state !== 'idle'
	const memorySearchPending =
		navigationMemorySearchPending || imageSearchPending
	const aiSearchPending = memorySearchPending || describePending
	const fetchedMemoryItems =
		data.filters.mode === 'memory' && imageFetcher.data?.ok
			? imageFetcher.data.items
			: null
	const displayedItems = fetchedMemoryItems ?? data.items
	const displayedTotal = fetchedMemoryItems?.length ?? data.total
	const displayedMemoryStatus =
		data.filters.mode === 'memory' && imageFetcher.data?.ok
			? memorySearchStatus({
					memorySearchSource: imageFetcher.data.source,
					memorySearchFallbackReason: imageFetcher.data.fallbackReason,
				})
			: memorySearchStatus(data)
	const loginRedirectTo = `${location.pathname}${location.search}`
	const filterKey = [
		data.filters.q,
		data.filters.kind,
		data.filters.mode,
		data.filters.genre,
		data.filters.year,
		data.filters.status,
		data.filters.provider,
		data.filters.sort,
	].join(':')

	return (
		<VeudPage aria-busy={aiSearchPending}>
			<VeudPageHeader
				eyebrow="Canonical catalog"
				title="Discover"
				description="Search titles or describe what you’re looking for."
			/>

			<nav className="discover-mode-switch" aria-label="Search mode">
				<Button
					asChild
					variant={data.filters.mode === 'standard' ? 'default' : 'outline'}
				>
					<Link to="/discover">Catalog search</Link>
				</Button>
				<Button
					asChild
					variant={data.filters.mode === 'memory' ? 'default' : 'outline'}
				>
					<Link to="/discover?mode=memory">Tip of My Tongue</Link>
				</Button>
				<Button
					asChild
					variant={data.filters.mode === 'describe' ? 'default' : 'outline'}
				>
					<Link to="/discover?mode=describe">Describe what you want</Link>
				</Button>
			</nav>

			<Form
				key={filterKey}
				method={data.filters.mode === 'describe' ? 'post' : 'get'}
				className={`discover-search-panel ${data.filters.mode !== 'standard' ? 'discover-search-panel--memory' : ''}`}
				aria-describedby={
					data.filters.mode !== 'standard'
						? 'discover-memory-privacy'
						: undefined
				}
				onSubmit={event => {
					if (data.filters.mode !== 'memory' || !data.isSignedIn) return
					event.preventDefault()
					imageFetcher.submit(new FormData(event.currentTarget), {
						method: 'post',
						action: '/resources/image-tip-of-tongue',
						encType: 'multipart/form-data',
					})
				}}
			>
				{data.filters.mode === 'memory' ? (
					<input type="hidden" name="mode" value="memory" />
				) : null}
				{data.filters.mode === 'describe' ? (
					<input type="hidden" name="intent" value="describe-start" />
				) : null}
				<div
					className={`space-y-2 ${data.filters.mode !== 'standard' ? 'discover-memory-prompt' : ''}`}
				>
					<Label htmlFor="discover-query">
						{data.filters.mode === 'memory'
							? 'What do you remember?'
							: data.filters.mode === 'describe'
								? 'What would you like to discover?'
								: 'Title or keyword'}
					</Label>
					{data.filters.mode !== 'standard' ? (
						<div className="discover-memory-input">
							<textarea
								id="discover-query"
								name="q"
								defaultValue={data.filters.q}
								placeholder={
									data.filters.mode === 'memory'
										? 'A hand-drawn movie where a girl follows a white rabbit into a city that changes shape…'
										: 'A psychological anime from the 1990s, under 30 episodes, without much romance…'
								}
								minLength={data.filters.mode === 'memory' ? undefined : 3}
								maxLength={500}
								rows={5}
								autoFocus
							/>
							{data.filters.mode === 'memory' && data.isSignedIn ? (
								<label className="discover-memory-attachment">
									<span>Add an image</span>
									<input
										name="image"
										type="file"
										accept="image/jpeg,image/png,image/webp"
										aria-label="Add a screenshot or cover"
									/>
								</label>
							) : null}
						</div>
					) : (
						<Input
							id="discover-query"
							name="q"
							defaultValue={data.filters.q}
							placeholder="Canonical or alternate title"
							maxLength={100}
						/>
					)}
				</div>
				<div className="space-y-2">
					<Label htmlFor="discover-kind">Media type</Label>
					<select
						id="discover-kind"
						name="kind"
						defaultValue={data.filters.kind}
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{Object.entries(kindLabels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>
				{data.filters.mode === 'standard' ? (
					<>
						<div className="space-y-2">
							<Label htmlFor="discover-genre">Genre</Label>
							<select
								id="discover-genre"
								name="genre"
								defaultValue={data.filters.genre}
								className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<option value="">All genres</option>
								{data.genres.map(genre => (
									<option key={genre} value={genre}>
										{genre}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="discover-year">Release year</Label>
							<Input
								id="discover-year"
								name="year"
								type="number"
								min={1870}
								max={2200}
								defaultValue={data.filters.year ?? ''}
								placeholder="Any year"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="discover-status">Release status</Label>
							<select
								id="discover-status"
								name="status"
								defaultValue={data.filters.status}
								className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<option value="">Any status</option>
								{data.statuses.map(status => (
									<option key={status} value={status}>
										{status}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="discover-provider">Provider</Label>
							<select
								id="discover-provider"
								name="provider"
								defaultValue={data.filters.provider}
								className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{Object.entries(providerLabels).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="discover-sort">Rank by</Label>
							<select
								id="discover-sort"
								name="sort"
								defaultValue={data.filters.sort}
								className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{Object.entries(sortLabels).map(([value, label]) =>
									value !== 'for-you' || data.isSignedIn ? (
										<option key={value} value={value}>
											{label}
										</option>
									) : null,
								)}
							</select>
						</div>
					</>
				) : data.filters.mode === 'memory' ? (
					<div id="discover-memory-privacy" className="discover-memory-privacy">
						{data.aiSearchAvailable
							? 'AI-assisted · add details, an image, or both.'
							: data.isSignedIn
								? 'Local catalog search'
								: 'Local search · sign in for AI and image matching'}
					</div>
				) : (
					<div id="discover-memory-privacy" className="discover-memory-privacy">
						{data.naturalDiscoveryAvailable
							? 'AI turns your request into editable filters.'
							: 'Discovery assistant unavailable.'}
					</div>
				)}
				<div className="discover-search-actions">
					<Button
						type="submit"
						className="flex-1 gap-2 lg:flex-none"
						disabled={
							aiSearchPending ||
							(data.filters.mode === 'describe' &&
								(!data.isSignedIn || !data.naturalDiscoveryAvailable))
						}
					>
						{aiSearchPending ? (
							<>
								<Icon
									name="update"
									className="animate-spin"
									aria-hidden="true"
								/>
								{data.filters.mode === 'describe'
									? 'Building search…'
									: 'Finding matches…'}
							</>
						) : data.filters.mode === 'memory' ? (
							'Find matches'
						) : data.filters.mode === 'describe' ? (
							data.isSignedIn && data.naturalDiscoveryAvailable ? (
								'Build search'
							) : data.isSignedIn ? (
								'Discovery assistant disabled'
							) : (
								'Sign in to describe a search'
							)
						) : (
							'Search catalog'
						)}
					</Button>
					{data.filters.mode === 'memory' ? (
						<Button
							type="reset"
							variant="ghost"
							onClick={() => imageFetcher.reset()}
						>
							Clear
						</Button>
					) : (
						<Button asChild type="button" variant="ghost">
							<Link
								to={
									data.filters.mode === 'describe'
										? '/discover?mode=describe'
										: '/discover'
								}
							>
								Clear
							</Link>
						</Button>
					)}
				</div>
			</Form>

			{imageFetcher.data && !imageFetcher.data.ok ? (
				<p
					className="rounded-xl border border-red-400/45 bg-red-950/30 p-3 text-red-100"
					role="alert"
				>
					{imageFetcher.data.error}
				</p>
			) : null}

			{data.naturalPlan && data.discoverySession ? (
				<section className="rounded-2xl border border-veud-border bg-veud-surface p-4 shadow-lg shadow-black/10 sm:p-5">
					{actionData && !actionData.ok ? (
						<p
							role="alert"
							className="mb-4 rounded-xl border border-red-400/45 bg-red-950/30 p-3 text-sm text-red-100"
						>
							{actionData.error}
						</p>
					) : null}
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-xs font-black uppercase tracking-[0.18em] text-veud-mint">
								Veud understood
							</p>
							<h2 className="mt-1 text-xl font-black text-veud-cream">
								{data.naturalPlan.explanation}
							</h2>
						</div>
						{data.discoverySession.currentStep > 0 ? (
							<Form method="post">
								<input type="hidden" name="intent" value="describe-undo" />
								<input
									type="hidden"
									name="sessionId"
									value={data.discoverySession!.id}
								/>
								<Button
									type="submit"
									variant="outline"
									disabled={describePending}
								>
									Undo last refinement
								</Button>
							</Form>
						) : null}
					</div>
					<div className="mt-4 grid gap-3 rounded-xl border border-veud-border/60 bg-black/10 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
						<ol className="grid gap-1 text-sm text-veud-copy">
							{data.discoverySession.phrases.map((phrase, index) => (
								<li
									key={`${index}:${phrase}`}
									className={
										index === data.discoverySession!.currentStep
											? 'font-bold text-veud-cream'
											: ''
									}
								>
									<span className="mr-2 text-veud-mint">{index + 1}.</span>
									{phrase}
								</li>
							))}
						</ol>
						<p className="text-sm font-black text-veud-mint">
							{data.total} result{data.total === 1 ? '' : 's'}
							{data.previousNaturalTotal === null
								? ''
								: ` · ${data.total - data.previousNaturalTotal >= 0 ? '+' : ''}${data.total - data.previousNaturalTotal} this turn`}
						</p>
					</div>
					<div
						className="mt-4 flex flex-wrap gap-2"
						aria-label="Active search constraints"
					>
						{data.naturalPlanChips.map(chip => (
							<Form key={`${chip.type}:${chip.value}`} method="post">
								<input type="hidden" name="intent" value="describe-remove" />
								<input
									type="hidden"
									name="sessionId"
									value={data.discoverySession!.id}
								/>
								<input type="hidden" name="chipType" value={chip.type} />
								<input type="hidden" name="chipValue" value={chip.value} />
								<button
									type="submit"
									className="min-h-9 rounded-full border border-veud-border bg-veud-canvas/70 px-3 py-1 text-sm text-veud-copy transition hover:border-red-300 hover:text-red-100"
									aria-label={`Remove ${chip.type} ${chip.value}`}
									title="Remove this constraint"
								>
									<strong>{chip.type}:</strong> {chip.value}{' '}
									<span aria-hidden="true">×</span>
								</button>
							</Form>
						))}
					</div>
					{data.naturalPlan.unsupportedConstraints.length ? (
						<div className="mt-4 rounded-xl border border-amber-400/35 bg-amber-950/20 p-3 text-sm text-amber-100">
							<strong>Not directly applied:</strong>{' '}
							{data.naturalPlan.unsupportedConstraints.join('; ')}
						</div>
					) : null}
					<Form method="post" className="mt-4 flex flex-col gap-3 sm:flex-row">
						<input type="hidden" name="intent" value="describe-refine" />
						<input
							type="hidden"
							name="sessionId"
							value={data.discoverySession.id}
						/>
						<Input
							name="refinement"
							required
							maxLength={500}
							placeholder="Refine it: less disturbing, series only, newer than 2010…"
							aria-label="Refine this discovery search"
						/>
						<Button type="submit" disabled={describePending}>
							{describePending ? 'Updating…' : 'Refine results'}
						</Button>
					</Form>
					<Form method="post" className="mt-3">
						<input type="hidden" name="intent" value="describe-relax" />
						<input
							type="hidden"
							name="sessionId"
							value={data.discoverySession.id}
						/>
						<Button type="submit" variant="ghost" disabled={describePending}>
							Relax one constraint
						</Button>
					</Form>
				</section>
			) : null}

			{memorySearchPending ? (
				<section
					className="discover-memory-loading"
					role="status"
					aria-live="polite"
					aria-label="Tip of My Tongue search in progress"
				>
					<div className="discover-memory-loading-reel" aria-hidden="true">
						<Icon name="magic-wand" />
					</div>
					<div>
						<h2>Finding five matches…</h2>
						<p>Checking your clues against Veud’s catalog.</p>
					</div>
				</section>
			) : null}

			{data.recommendationGraph ? (
				<RecommendationLanes
					graph={data.recommendationGraph}
					watchlists={data.watchlists}
					loginRedirectTo={loginRedirectTo}
				/>
			) : null}

			{data.recommendationGraph ||
			(data.filters.mode === 'memory' &&
				!data.filters.q &&
				!imageFetcher.data?.ok) ? null : (
				<section
					className={`space-y-4 ${memorySearchPending ? 'discover-results--pending' : ''}`}
					aria-labelledby="discovery-results-heading"
				>
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h2
								id="discovery-results-heading"
								className="text-2xl font-black text-veud-yellow"
							>
								{data.filters.mode === 'memory'
									? 'Closest matches'
									: sortLabels[data.filters.sort]}
							</h2>
							{data.filters.mode === 'standard' &&
							data.filters.sort === 'for-you' ? (
								<p className="mt-1 text-sm text-veud-mint">
									{data.preferredGenres.length
										? `Inspired by ${data.preferredGenres.join(', ')}.`
										: 'Rate or favorite a few titles to shape this page.'}
								</p>
							) : data.filters.mode === 'standard' &&
							  data.filters.sort === 'popular' ? (
								<p className="mt-1 max-w-3xl text-sm text-veud-mint">
									Popularity is normalized within each provider and media type.
								</p>
							) : data.filters.mode === 'standard' &&
							  data.filters.sort === 'top-rated' ? (
								<p className="mt-1 max-w-3xl text-sm text-veud-mint">
									Ratings are weighted by audience size.
								</p>
							) : null}
						</div>
						<p className="text-sm text-veud-mint">
							{data.filters.mode === 'memory'
								? `${displayedTotal} of 5 matches · ${displayedMemoryStatus}`
								: resultSummary(data.total, data.filters)}
						</p>
					</header>

					{displayedItems.length ? (
						<div
							className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${data.filters.mode === 'memory' ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
						>
							{displayedItems.map(item => {
								const poster = splitLegacyThumbnail(item.thumbnail).imageUrl
								return (
									<article
										key={item.id}
										className="group flex flex-col overflow-hidden rounded-2xl border border-veud-border/70 bg-veud-surface shadow-lg shadow-black/10 transition hover:-translate-y-1 hover:border-veud-mint hover:shadow-xl hover:shadow-black/20"
									>
										<Link to={`/media/${item.id}`} className="block flex-1">
											<div className="aspect-[2/3] overflow-hidden bg-veud-ink">
												{poster ? (
													<img
														src={poster}
														alt=""
														loading="lazy"
														className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
													/>
												) : (
													<div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-veud-sage">
														No poster available
													</div>
												)}
											</div>
											<div className="space-y-3 p-4">
												<div>
													<div className="flex flex-wrap gap-2 text-[0.7rem] font-bold uppercase tracking-wide text-veud-mint">
														<span>
															{item.type ||
																kindLabels[
																	item.kind as DiscoveryQuery['kind']
																] ||
																item.kind}
														</span>
														{item.year ? <span>· {item.year}</span> : null}
														{item.releaseStatus ? (
															<span>· {item.releaseStatus}</span>
														) : null}
													</div>
													<h3 className="mt-1 text-lg font-black leading-6 text-veud-yellow group-hover:underline">
														{item.title}
													</h3>
													{item.matchedTitle ? (
														<p className="mt-1 text-xs text-veud-mint">
															Also known as {item.matchedTitle}
														</p>
													) : null}
													{item.providers.length ? (
														<div className="mt-2 flex flex-wrap gap-1.5">
															{item.providers.map(provider => (
																<span
																	key={provider}
																	className="rounded bg-veud-ink px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-veud-gold"
																>
																	{provider}
																</span>
															))}
														</div>
													) : null}
												</div>
												{item.genres.length ? (
													<div className="flex flex-wrap gap-1.5">
														{item.genres.slice(0, 3).map(genre => (
															<span
																key={genre}
																className="rounded-full bg-veud-ink px-2 py-1 text-xs text-veud-copy"
															>
																{genre}
															</span>
														))}
													</div>
												) : null}
												{item.memoryMatch ? (
													<div
														className="rounded-xl border border-veud-mint/30 bg-veud-ink p-3 text-sm leading-5 text-veud-copy"
														aria-label="Memory match explanation"
													>
														<HighlightedMemorySummary
															summary={item.memoryMatch.summary}
															clues={item.memoryMatch.matchedClues}
														/>
														{item.memoryMatch.matchedClues.length ? (
															<div
																className="mt-2 flex flex-wrap items-center gap-1.5"
																aria-label="Details matching your description"
															>
																<span className="mr-1 text-[0.68rem] font-bold uppercase tracking-wide text-veud-sage">
																	Matches
																</span>
																{item.memoryMatch.matchedClues.map(clue => (
																	<mark
																		key={clue}
																		className="rounded-full bg-veud-mint px-2 py-0.5 text-xs font-bold text-veud-ink"
																	>
																		{clue}
																	</mark>
																))}
															</div>
														) : null}
													</div>
												) : null}
												{item.description ? (
													<p className="line-clamp-3 text-sm leading-5 text-veud-copy">
														{item.description}
													</p>
												) : null}
												<div className="border-t border-veud-border/60 pt-3 text-xs text-veud-mint">
													{item.communityScore !== null ? (
														<span className="font-bold text-veud-gold">
															★ {item.communityScore.toFixed(1)} (
															{item.ratingCount})
														</span>
													) : (
														<span>
															{item.providerScore !== null
																? `Provider ★ ${item.providerScore.toFixed(1)}`
																: 'Not yet rated'}
														</span>
													)}
													<span className="mx-2">·</span>
													<span>{item.trackerCount} tracking</span>
													{item.reviewCount ? (
														<>
															<span className="mx-2">·</span>
															<span>
																{item.reviewCount}{' '}
																{item.reviewCount === 1 ? 'review' : 'reviews'}
															</span>
														</>
													) : null}
													{item.diaryCount ? (
														<>
															<span className="mx-2">·</span>
															<span>
																{item.diaryCount}{' '}
																{item.diaryCount === 1
																	? 'diary log'
																	: 'diary logs'}
															</span>
														</>
													) : null}
												</div>
											</div>
										</Link>
										<div className="border-t border-veud-border/60 p-3">
											<QuickTrackControl
												item={item}
												watchlists={data.watchlists}
												isSignedIn={data.isSignedIn}
												loginRedirectTo={loginRedirectTo}
											/>
										</div>
									</article>
								)
							})}
						</div>
					) : (
						<VeudEmptyState
							title={
								data.filters.mode === 'memory'
									? 'No close matches yet'
									: 'No titles found'
							}
							action={
								<Button asChild variant="outline">
									<Link to="/discover">Clear filters</Link>
								</Button>
							}
						>
							<p>
								{data.memoryQueryTooShort
									? 'Describe at least three characters of what you remember.'
									: 'Try a broader search, another media type, or clear the filters to explore the full catalog.'}
							</p>
						</VeudEmptyState>
					)}

					{data.pageCount > 1 ? (
						<nav
							aria-label="Discovery pages"
							className="flex items-center justify-center gap-4 pt-3"
						>
							{data.filters.page > 1 ? (
								<Button asChild variant="outline">
									<Link
										to={discoveryHref(
											data.filters,
											data.filters.page - 1,
											data.discoverySession?.id,
										)}
									>
										Previous
									</Link>
								</Button>
							) : (
								<Button type="button" variant="outline" disabled>
									Previous
								</Button>
							)}
							<span className="text-sm font-semibold text-veud-mint">
								Page {data.filters.page} of {data.pageCount}
							</span>
							{data.filters.page < data.pageCount ? (
								<Button asChild variant="outline">
									<Link
										to={discoveryHref(
											data.filters,
											data.filters.page + 1,
											data.discoverySession?.id,
										)}
									>
										Next
									</Link>
								</Button>
							) : (
								<Button type="button" variant="outline" disabled>
									Next
								</Button>
							)}
						</nav>
					) : null}
				</section>
			)}
		</VeudPage>
	)
}

export const meta: MetaFunction = () => [
	{ title: 'Discover · Veud' },
	{
		name: 'description',
		content: 'Search and explore movies, television, anime, and manga on Veud.',
	},
]

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
