import {
	data as json,
	Form,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import {
	getDiscoveryGenres,
	getDiscoveryResults,
	parseDiscoveryQuery,
	type DiscoveryQuery,
} from '#app/utils/discovery.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

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

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const filters = parseDiscoveryQuery(new URL(request.url).searchParams)
	const [discovery, genres] = await Promise.all([
		getDiscoveryResults(filters, viewerId),
		getDiscoveryGenres(),
	])
	return json({ ...discovery, genres, isSignedIn: Boolean(viewerId) })
}

function discoveryHref(filters: DiscoveryQuery, page: number) {
	const searchParams = new URLSearchParams()
	if (filters.q) searchParams.set('q', filters.q)
	if (filters.kind !== 'all') searchParams.set('kind', filters.kind)
	if (filters.genre) searchParams.set('genre', filters.genre)
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

export default function DiscoverRoute() {
	const data = useLoaderData<typeof loader>()
	const filterKey = [
		data.filters.q,
		data.filters.kind,
		data.filters.genre,
		data.filters.sort,
	].join(':')

	return (
		<main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-8 text-[#ffefcc] sm:px-6 lg:px-8">
			<header className="max-w-3xl space-y-2">
				<p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a2ffd5]">
					Canonical catalog
				</p>
				<h1 className="text-4xl font-black text-[#ff9900]">Discover</h1>
				<p className="text-base leading-7 text-[#c6ded2]">
					Search every shared title, explore what the community is tracking, or
					find something shaped by your own taste.
				</p>
			</header>

			<Form
				key={filterKey}
				method="get"
				className="grid gap-4 rounded-2xl border border-[#54806c] bg-[#383040] p-5 md:grid-cols-2 lg:grid-cols-[minmax(16rem,2fr)_repeat(3,minmax(9rem,1fr))_auto] lg:items-end"
			>
				<div className="space-y-2">
					<Label htmlFor="discover-query">Title or keyword</Label>
					<Input
						id="discover-query"
						name="q"
						defaultValue={data.filters.q}
						placeholder="Search titles and descriptions"
						maxLength={100}
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
				<div className="flex gap-2">
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
							{sortLabels[data.filters.sort]}
						</h2>
						{data.filters.sort === 'for-you' ? (
							<p className="mt-1 text-sm text-[#a2ffd5]">
								{data.preferredGenres.length
									? `Built from your interest in ${data.preferredGenres.join(', ')}. Already tracked titles are hidden.`
									: 'Track and rate a few titles to teach Veud your taste. Until then, community favorites lead the way.'}
							</p>
						) : null}
					</div>
					<p className="text-sm text-[#a2ffd5]">
						{resultSummary(data.total, data.filters)}
					</p>
				</header>

				{data.items.length ? (
					<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{data.items.map(item => {
							const poster = splitLegacyThumbnail(item.thumbnail).imageUrl
							return (
								<article
									key={item.id}
									className="group overflow-hidden rounded-2xl border border-[#54806c] bg-[#383040] transition hover:-translate-y-1 hover:border-[#a2ffd5] hover:shadow-xl"
								>
									<Link to={`/media/${item.id}`} className="block h-full">
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
												</div>
												<h3 className="mt-1 text-lg font-black leading-6 text-[#ffffb1] group-hover:underline">
													{item.title}
												</h3>
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
													<span>Not yet rated</span>
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
								</article>
							)
						})}
					</div>
				) : (
					<div className="rounded-2xl border border-dashed border-[#54806c] bg-[#383040] px-6 py-16 text-center">
						<h3 className="text-xl font-black text-[#ffffb1]">
							No titles found
						</h3>
						<p className="mx-auto mt-2 max-w-lg text-[#a2ffd5]">
							Try a broader search, another media type, or clear the filters to
							explore the full catalog.
						</p>
						<Button asChild variant="outline" className="mt-5">
							<Link to="/discover">Clear filters</Link>
						</Button>
					</div>
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
		</main>
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
