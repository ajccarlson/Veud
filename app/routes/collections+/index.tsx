import { type Prisma } from '@prisma/client'
import {
	data as json,
	Form,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { MediaCollectionCard } from '#app/components/media-collection-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import {
	getPersonalizedCollectionRanking,
	getTrendingCollectionIds,
} from '#app/utils/collection-discovery.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { normalizeCollectionTag } from '#app/utils/media-collections.ts'

const PAGE_SIZE = 24
type CollectionSort = 'recent' | 'popular' | 'trending' | 'for-you'

type CollectionRanking = {
	items: Array<{ id: string; reason: string | null }>
	personalization: {
		followedPeople: number
		tasteTitles: number
		likedTags: number
	} | null
}

const collectionCardSelect = {
	id: true,
	title: true,
	description: true,
	isPublic: true,
	featuredAt: true,
	updatedAt: true,
	owner: { select: { username: true, name: true } },
	_count: { select: { items: true, likes: true, comments: true } },
	tags: {
		orderBy: { tag: { name: 'asc' as const } },
		select: { tag: { select: { name: true, slug: true } } },
	},
	items: {
		orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
		take: 4,
		select: {
			media: { select: { id: true, title: true, thumbnail: true } },
		},
	},
} satisfies Prisma.MediaCollectionSelect

function parsePage(value: string | null) {
	const page = Number(value)
	return Number.isInteger(page) && page > 0 ? page : 1
}

function collectionsHref(
	query: string,
	sort: CollectionSort,
	page: number,
	tag: string,
) {
	const params = new URLSearchParams()
	if (query) params.set('q', query)
	if (sort !== 'recent') params.set('sort', sort)
	if (tag) params.set('tag', tag)
	if (page > 1) params.set('page', String(page))
	const search = params.toString()
	return search ? `/collections?${search}` : '/collections'
}

function personalizationSummary(signals: {
	followedPeople: number
	tasteTitles: number
	likedTags: number
}) {
	const sources = [
		signals.followedPeople
			? `${signals.followedPeople} followed ${signals.followedPeople === 1 ? 'member' : 'members'}`
			: null,
		signals.tasteTitles
			? `${signals.tasteTitles} ${signals.tasteTitles === 1 ? 'title' : 'titles'} you enjoyed`
			: null,
		signals.likedTags
			? `${signals.likedTags} ${signals.likedTags === 1 ? 'tag' : 'tags'} from liked collections`
			: null,
	].filter((source): source is string => Boolean(source))
	return sources.length
		? `Ranked using ${sources.join(', ')}.`
		: 'Follow members, track favorites, or like collections to shape these recommendations. Community activity fills in the gaps.'
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const url = new URL(request.url)
	const query = url.searchParams.get('q')?.trim().slice(0, 100) ?? ''
	const requestedTag = url.searchParams.get('tag')?.trim().slice(0, 100) ?? ''
	const normalizedTag = requestedTag
		? normalizeCollectionTag(requestedTag)
		: null
	const tagSlug = normalizedTag?.slug ?? ''
	const requestedSort = url.searchParams.get('sort')
	const sort: CollectionSort =
		requestedSort === 'for-you'
			? viewerId
				? 'for-you'
				: 'recent'
			: requestedSort === 'popular' || requestedSort === 'trending'
				? requestedSort
				: 'recent'
	const requestedPage = parsePage(url.searchParams.get('page'))
	const visibility: Prisma.MediaCollectionWhereInput = viewerId
		? { OR: [{ isPublic: true }, { ownerId: viewerId }] }
		: { isPublic: true }
	const where = {
		AND: [
			visibility,
			...(query
				? [
						{
							OR: [
								{ title: { contains: query } },
								{ description: { contains: query } },
								{ owner: { username: { contains: query } } },
							],
						},
					]
				: []),
			...(tagSlug ? [{ tags: { some: { tag: { slug: tagSlug } } } }] : []),
		],
	}
	const rankingRequest: Promise<CollectionRanking> | null =
		sort === 'trending'
			? getTrendingCollectionIds(where).then(ids => ({
					items: ids.map(id => ({ id, reason: null })),
					personalization: null,
				}))
			: sort === 'for-you' && viewerId
				? getPersonalizedCollectionRanking(viewerId, where).then(result => ({
						items: result.items.map(item => ({
							id: item.id,
							reason: item.reason,
						})),
						personalization: result.signals,
					}))
				: null
	const [rankingOrTotal, availableTags, activeTag, featuredCollections] =
		await Promise.all([
			rankingRequest ?? prisma.mediaCollection.count({ where }),
			prisma.collectionTag.findMany({
				where: { collections: { some: { collection: visibility } } },
				orderBy: [{ collections: { _count: 'desc' } }, { name: 'asc' }],
				take: 30,
				select: { name: true, slug: true },
			}),
			tagSlug
				? prisma.collectionTag.findFirst({
						where: {
							slug: tagSlug,
							collections: { some: { collection: visibility } },
						},
						select: { name: true, slug: true },
					})
				: null,
			requestedPage === 1 && !query && !tagSlug
				? prisma.mediaCollection.findMany({
						where: { isPublic: true, featuredAt: { not: null } },
						orderBy: [{ featuredAt: 'desc' }, { id: 'desc' }],
						take: 3,
						select: collectionCardSelect,
					})
				: Promise.resolve([]),
		])
	const ranking = typeof rankingOrTotal === 'number' ? null : rankingOrTotal
	const total =
		typeof rankingOrTotal === 'number'
			? rankingOrTotal
			: rankingOrTotal.items.length
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
	const page = Math.min(requestedPage, pageCount)
	const pageRanking = ranking?.items.slice(
		(page - 1) * PAGE_SIZE,
		page * PAGE_SIZE,
	)
	const pageIds = pageRanking?.map(item => item.id)
	let collectionRows = await prisma.mediaCollection.findMany({
		where: pageIds ? { id: { in: pageIds } } : where,
		orderBy: pageIds
			? undefined
			: sort === 'popular'
				? [{ likes: { _count: 'desc' } }, { updatedAt: 'desc' }, { id: 'desc' }]
				: [{ updatedAt: 'desc' }, { id: 'desc' }],
		skip: pageIds ? undefined : (page - 1) * PAGE_SIZE,
		take: pageIds ? undefined : PAGE_SIZE,
		select: collectionCardSelect,
	})
	if (pageIds) {
		const position = new Map(pageIds.map((id, index) => [id, index]))
		collectionRows = collectionRows.sort(
			(a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
		)
	}
	const recommendationReasons = new Map(
		pageRanking?.map(item => [item.id, item.reason]) ?? [],
	)
	const collections = collectionRows.map(collection => ({
		...collection,
		recommendationReason: recommendationReasons.get(collection.id) ?? null,
	}))
	return json({
		collections,
		featuredCollections,
		personalization: ranking?.personalization ?? null,
		query,
		sort,
		activeTag,
		availableTags,
		total,
		page,
		pageCount,
		isSignedIn: Boolean(viewerId),
	})
}

export default function CollectionsIndex() {
	const data = useLoaderData<typeof loader>()
	return (
		<main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-8 text-[#ffefcc] sm:px-6 lg:px-8">
			<header className="flex flex-wrap items-end justify-between gap-5">
				<div className="max-w-3xl space-y-2">
					<p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a2ffd5]">
						Community picks
					</p>
					<h1 className="text-4xl font-black text-[#ff9900]">Collections</h1>
					<p className="leading-7 text-[#c6ded2]">
						Explore themed lists, personal favorites, and recommendations built
						from Veud’s shared catalog.
					</p>
				</div>
				<Button asChild>
					<Link
						to={
							data.isSignedIn
								? '/collections/new'
								: '/login?redirectTo=%2Fcollections%2Fnew'
						}
					>
						Create a collection
					</Link>
				</Button>
			</header>

			{data.featuredCollections.length ? (
				<section className="space-y-4 rounded-2xl border border-[#ff9900]/60 bg-[#383040] p-5">
					<div>
						<p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff9900]">
							Editorial
						</p>
						<h2 className="mt-1 text-2xl font-black text-[#ffffb1]">
							Staff picks
						</h2>
					</div>
					<div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
						{data.featuredCollections.map(collection => (
							<MediaCollectionCard
								key={collection.id}
								collection={collection}
							/>
						))}
					</div>
				</section>
			) : null}

			<Form
				method="get"
				className="grid max-w-3xl gap-3 rounded-2xl border border-[#54806c] bg-[#383040] p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
			>
				{data.activeTag ? (
					<input type="hidden" name="tag" value={data.activeTag.slug} />
				) : null}
				<div className="flex-1 space-y-2">
					<Label htmlFor="collection-query">Find collections</Label>
					<Input
						id="collection-query"
						name="q"
						defaultValue={data.query}
						placeholder="Title, description, or creator"
						maxLength={100}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="collection-sort">Sort by</Label>
					<select
						id="collection-sort"
						name="sort"
						defaultValue={data.sort}
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
					>
						{data.isSignedIn ? <option value="for-you">For you</option> : null}
						<option value="trending">Trending now</option>
						<option value="recent">Recently updated</option>
						<option value="popular">Most liked</option>
					</select>
				</div>
				<Button type="submit" variant="outline">
					Search
				</Button>
			</Form>

			{data.availableTags.length ? (
				<nav
					aria-label="Browse collection tags"
					className="flex flex-wrap gap-2"
				>
					<Link
						to={collectionsHref(data.query, data.sort, 1, '')}
						className={`rounded-full border px-3 py-1 text-sm font-bold ${
							data.activeTag
								? 'border-[#54806c] text-[#a2ffd5]'
								: 'border-[#ff9900] bg-[#ff9900]/10 text-[#ffffb1]'
						}`}
					>
						All tags
					</Link>
					{data.availableTags.map(tag => (
						<Link
							key={tag.slug}
							to={collectionsHref(data.query, data.sort, 1, tag.slug)}
							className={`rounded-full border px-3 py-1 text-sm font-bold ${
								data.activeTag?.slug === tag.slug
									? 'border-[#ff9900] bg-[#ff9900]/10 text-[#ffffb1]'
									: 'border-[#54806c] text-[#a2ffd5] hover:border-[#a2ffd5]'
							}`}
						>
							#{tag.name}
						</Link>
					))}
				</nav>
			) : null}

			<section className="space-y-4">
				{data.personalization ? (
					<div className="rounded-2xl border border-[#a2ffd5]/60 bg-[#383040] px-5 py-4">
						<p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a2ffd5]">
							Personalized discovery
						</p>
						<h2 className="mt-1 text-2xl font-black text-[#ffffb1]">
							Picked for you
						</h2>
						<p className="mt-1 text-sm leading-6 text-[#c6ded2]">
							{personalizationSummary(data.personalization)}
						</p>
					</div>
				) : null}
				<p className="text-sm font-semibold text-[#a2ffd5]">
					{data.total} {data.total === 1 ? 'collection' : 'collections'}
					{data.activeTag ? ` tagged #${data.activeTag.name}` : ''}
				</p>
				{data.collections.length ? (
					<div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
						{data.collections.map(collection => (
							<MediaCollectionCard
								key={collection.id}
								collection={collection}
							/>
						))}
					</div>
				) : (
					<div className="rounded-2xl border border-dashed border-[#54806c] bg-[#383040] px-6 py-16 text-center">
						<h2 className="text-xl font-black text-[#ffffb1]">
							No collections found
						</h2>
						<p className="mt-2 text-[#a2ffd5]">
							Try a broader search or start the first one.
						</p>
					</div>
				)}
			</section>

			{data.pageCount > 1 ? (
				<nav
					aria-label="Collection pages"
					className="flex items-center justify-center gap-4"
				>
					<Button
						asChild={data.page > 1}
						variant="outline"
						disabled={data.page <= 1}
					>
						{data.page > 1 ? (
							<Link
								to={collectionsHref(
									data.query,
									data.sort,
									data.page - 1,
									data.activeTag?.slug ?? '',
								)}
							>
								Previous
							</Link>
						) : (
							<span>Previous</span>
						)}
					</Button>
					<span className="text-sm font-semibold text-[#a2ffd5]">
						Page {data.page} of {data.pageCount}
					</span>
					<Button
						asChild={data.page < data.pageCount}
						variant="outline"
						disabled={data.page >= data.pageCount}
					>
						{data.page < data.pageCount ? (
							<Link
								to={collectionsHref(
									data.query,
									data.sort,
									data.page + 1,
									data.activeTag?.slug ?? '',
								)}
							>
								Next
							</Link>
						) : (
							<span>Next</span>
						)}
					</Button>
				</nav>
			) : null}
		</main>
	)
}

export const meta: MetaFunction = () => [
	{ title: 'Collections · Veud' },
	{
		name: 'description',
		content: 'Browse community-curated media collections on Veud.',
	},
]
