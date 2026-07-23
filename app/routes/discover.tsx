import {
	data as json,
	Form,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
	useLocation,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { QuickTrackControl } from '#app/components/quick-track-control.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
} from '#app/components/ui/veud-layout.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	getDiscoveryGenres,
	getDiscoveryResults,
	getDiscoveryResultsForMediaIds,
	getDiscoveryStatuses,
	parseDiscoveryQuery,
	type DiscoveryQuery,
} from '#app/utils/discovery.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { getTipOfTongueMatches } from '#app/utils/tip-of-tongue.server.ts'

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

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const filters = parseDiscoveryQuery(new URL(request.url).searchParams)
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
	const [discovery, genres, statuses, watchlists] = await Promise.all([
		memorySearch
			? getDiscoveryResultsForMediaIds(
					filters,
					viewerId,
					memorySearch.matches.map(match => match.mediaId),
				)
			: getDiscoveryResults(filters, viewerId),
		genresPromise,
		statusesPromise,
		watchlistsPromise,
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
		aiSearchAvailable: Boolean(viewerId && process.env.OPENAI_API_KEY?.trim()),
		genres,
		statuses,
		watchlists,
		isSignedIn: Boolean(viewerId),
	})
}

function memorySearchStatus(data: {
	memorySearchSource: 'ai' | 'catalog-match' | null
	memorySearchFallbackReason:
		| 'not-configured'
		| 'sign-in-required'
		| 'rate-limited'
		| 'ai-error'
		| 'ai-empty'
		| 'provider-restricted'
		| null
}) {
	if (data.memorySearchSource === 'ai') return 'AI ranked'
	switch (data.memorySearchFallbackReason) {
		case 'sign-in-required':
			return 'Catalog matched · sign in for AI ranking'
		case 'rate-limited':
			return 'Catalog matched · AI limit reached'
		case 'ai-error':
			return 'Catalog matched · AI temporarily unavailable'
		case 'ai-empty':
			return 'Catalog matched · AI returned no usable matches'
		case 'provider-restricted':
			return 'Catalog matched · provider terms limit AI ranking'
		case 'not-configured':
			return 'Catalog matched · AI not configured'
		default:
			return 'Catalog matched'
	}
}

function discoveryHref(filters: DiscoveryQuery, page: number) {
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
	const location = useLocation()
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
		<VeudPage>
			<VeudPageHeader
				eyebrow="Canonical catalog"
				title="Discover"
				description={
					<p>
						Search every shared title, explore what the community is tracking,
						or find something shaped by your own taste.
					</p>
				}
			/>

			<Form
				key={filterKey}
				method="get"
				className="grid gap-4 rounded-2xl border border-veud-border bg-veud-surface p-4 shadow-lg shadow-black/10 sm:p-5 md:grid-cols-2 xl:grid-cols-4 xl:items-end"
			>
				<div className="space-y-2">
					<Label htmlFor="discover-query">Title or keyword</Label>
					<Input
						id="discover-query"
						name="q"
						defaultValue={data.filters.q}
						placeholder={
							data.filters.mode === 'memory'
								? 'Describe scenes, characters, era, tone, or plot details'
								: 'Canonical or alternate title'
						}
						maxLength={data.filters.mode === 'memory' ? 500 : 100}
					/>
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
				<label
					htmlFor="discover-memory-mode"
					className="flex gap-3 rounded-xl border border-[#54806c]/70 bg-[#2e2f2b] p-3 md:col-span-2 xl:col-span-4"
				>
					<span className="sr-only">Enable Tip of My Tongue search</span>
					<input
						id="discover-memory-mode"
						type="checkbox"
						name="mode"
						value="memory"
						defaultChecked={data.filters.mode === 'memory'}
						className="mt-1 h-4 w-4 shrink-0 accent-[#a2ffd5]"
					/>
					<span>
						<strong className="block text-sm text-[#ffffb1]">
							Tip of My Tongue
						</strong>
						<span className="mt-1 block text-xs leading-5 text-[#a2ffd5]">
							{data.aiSearchAvailable
								? 'Describe whatever you remember. AI will rank five catalog-backed matches; your description is sent to OpenAI with response storage disabled. Do not include personal information.'
								: data.isSignedIn
									? 'Describe whatever you remember. Veud will return five local catalog matches; AI ranking is not configured on this server.'
									: 'Describe whatever you remember for local catalog matching. Sign in to use AI ranking when it is configured.'}
						</span>
					</span>
				</label>
				<div className="flex gap-2 xl:col-span-4 xl:justify-end">
					<Button type="submit" className="flex-1 lg:flex-none">
						Discover
					</Button>
					<Button asChild type="button" variant="ghost">
						<Link to="/discover">Clear</Link>
					</Button>
				</div>
			</Form>

			<section
				className="space-y-4"
				aria-labelledby="discovery-results-heading"
			>
				<header className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2
							id="discovery-results-heading"
							className="text-2xl font-black text-[#ffffb1]"
						>
							{data.filters.mode === 'memory'
								? 'Closest matches'
								: sortLabels[data.filters.sort]}
						</h2>
						{data.filters.sort === 'for-you' ? (
							<p className="mt-1 text-sm text-[#a2ffd5]">
								{data.preferredGenres.length
									? `Built from your interest in ${data.preferredGenres.join(', ')}. Already tracked or favorited titles are hidden.`
									: 'Track, rate, or favorite a few titles to teach Veud your taste. Until then, community favorites lead the way.'}
							</p>
						) : null}
					</div>
					<p className="text-sm text-[#a2ffd5]">
						{data.filters.mode === 'memory'
							? `${data.total} of 5 possible matches · ${memorySearchStatus(data)}`
							: resultSummary(data.total, data.filters)}
					</p>
				</header>

				{data.items.length ? (
					<div
						className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${data.filters.mode === 'memory' ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
					>
						{data.items.map(item => {
							const poster = splitLegacyThumbnail(item.thumbnail).imageUrl
							return (
								<article
									key={item.id}
									className="group flex flex-col overflow-hidden rounded-2xl border border-[#54806c] bg-[#383040] transition hover:-translate-y-1 hover:border-[#a2ffd5] hover:shadow-xl"
								>
									<Link to={`/media/${item.id}`} className="block flex-1">
										<div className="aspect-[2/3] overflow-hidden bg-[#2e2f2b]">
											{poster ? (
												<img
													src={poster}
													alt=""
													loading="lazy"
													className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
												/>
											) : (
												<div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-[#8ca99d]">
													No poster available
												</div>
											)}
										</div>
										<div className="space-y-3 p-4">
											<div>
												<div className="flex flex-wrap gap-2 text-[0.7rem] font-bold uppercase tracking-wide text-[#a2ffd5]">
													<span>
														{item.type ||
															kindLabels[item.kind as DiscoveryQuery['kind']] ||
															item.kind}
													</span>
													{item.year ? <span>· {item.year}</span> : null}
													{item.releaseStatus ? (
														<span>· {item.releaseStatus}</span>
													) : null}
												</div>
												<h3 className="mt-1 text-lg font-black leading-6 text-[#ffffb1] group-hover:underline">
													{item.title}
												</h3>
												{item.matchedTitle ? (
													<p className="mt-1 text-xs text-[#a2ffd5]">
														Also known as {item.matchedTitle}
													</p>
												) : null}
												{item.providers.length ? (
													<div className="mt-2 flex flex-wrap gap-1.5">
														{item.providers.map(provider => (
															<span
																key={provider}
																className="rounded bg-[#2e2f2b] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-[#ffcc66]"
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
															className="rounded-full bg-[#2e2f2b] px-2 py-1 text-xs text-[#c6ded2]"
														>
															{genre}
														</span>
													))}
												</div>
											) : null}
											{item.memoryMatch ? (
												<div
													className="rounded-xl border border-[#a2ffd5]/30 bg-[#211f24] p-3 text-sm leading-5 text-[#d7e9df]"
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
															<span className="mr-1 text-[0.68rem] font-bold uppercase tracking-wide text-[#8ca99d]">
																Matches
															</span>
															{item.memoryMatch.matchedClues.map(clue => (
																<mark
																	key={clue}
																	className="rounded-full bg-[#a2ffd5] px-2 py-0.5 text-xs font-bold text-[#222]"
																>
																	{clue}
																</mark>
															))}
														</div>
													) : null}
												</div>
											) : null}
											{item.description ? (
												<p className="line-clamp-3 text-sm leading-5 text-[#c6ded2]">
													{item.description}
												</p>
											) : null}
											<div className="border-t border-[#54806c]/60 pt-3 text-xs text-[#a2ffd5]">
												{item.communityScore !== null ? (
													<span className="font-bold text-[#ffcc66]">
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
									<div className="border-t border-[#54806c]/60 p-3">
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
								<Link to={discoveryHref(data.filters, data.filters.page - 1)}>
									Previous
								</Link>
							</Button>
						) : (
							<Button type="button" variant="outline" disabled>
								Previous
							</Button>
						)}
						<span className="text-sm font-semibold text-[#a2ffd5]">
							Page {data.filters.page} of {data.pageCount}
						</span>
						{data.filters.page < data.pageCount ? (
							<Button asChild variant="outline">
								<Link to={discoveryHref(data.filters, data.filters.page + 1)}>
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
