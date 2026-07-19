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
import { prisma } from '#app/utils/db.server.ts'

const PAGE_SIZE = 24
type CollectionSort = 'recent' | 'popular'

function parsePage(value: string | null) {
	const page = Number(value)
	return Number.isInteger(page) && page > 0 ? page : 1
}

function collectionsHref(query: string, sort: CollectionSort, page: number) {
	const params = new URLSearchParams()
	if (query) params.set('q', query)
	if (sort !== 'recent') params.set('sort', sort)
	if (page > 1) params.set('page', String(page))
	const search = params.toString()
	return search ? `/collections?${search}` : '/collections'
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const url = new URL(request.url)
	const query = url.searchParams.get('q')?.trim().slice(0, 100) ?? ''
	const sort: CollectionSort =
		url.searchParams.get('sort') === 'popular' ? 'popular' : 'recent'
	const requestedPage = parsePage(url.searchParams.get('page'))
	const visibility = viewerId
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
		],
	}
	const total = await prisma.mediaCollection.count({ where })
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
	const page = Math.min(requestedPage, pageCount)
	const collections = await prisma.mediaCollection.findMany({
		where,
		orderBy:
			sort === 'popular'
				? [{ likes: { _count: 'desc' } }, { updatedAt: 'desc' }, { id: 'desc' }]
				: [{ updatedAt: 'desc' }, { id: 'desc' }],
		skip: (page - 1) * PAGE_SIZE,
		take: PAGE_SIZE,
		select: {
			id: true,
			title: true,
			description: true,
			isPublic: true,
			updatedAt: true,
			owner: { select: { username: true, name: true } },
			_count: { select: { items: true, likes: true, comments: true } },
			items: {
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				take: 4,
				select: {
					media: { select: { id: true, title: true, thumbnail: true } },
				},
			},
		},
	})
	return json({
		collections,
		query,
		sort,
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

			<Form
				method="get"
				className="grid max-w-3xl gap-3 rounded-2xl border border-[#54806c] bg-[#383040] p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
			>
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
						<option value="recent">Recently updated</option>
						<option value="popular">Most liked</option>
					</select>
				</div>
				<Button type="submit" variant="outline">
					Search
				</Button>
			</Form>

			<section className="space-y-4">
				<p className="text-sm font-semibold text-[#a2ffd5]">
					{data.total} {data.total === 1 ? 'collection' : 'collections'}
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
							<Link to={collectionsHref(data.query, data.sort, data.page - 1)}>
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
							<Link to={collectionsHref(data.query, data.sort, data.page + 1)}>
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
