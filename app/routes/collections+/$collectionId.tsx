import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	Form,
	Link,
	redirect,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	addCollectionItem,
	moveCollectionItem,
	removeCollectionItem,
	requireCollectionOwner,
	visibleCollectionWhere,
} from '#app/utils/media-collections.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

const CollectionItemActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('add-item'),
		mediaId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('remove-item'),
		itemId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('move-item'),
		itemId: z.string().min(1).max(100),
		direction: z.enum(['up', 'down']),
	}),
])

export async function loader({ request, params }: LoaderFunctionArgs) {
	const collectionId = params.collectionId
	invariantResponse(collectionId, 'Collection not found', { status: 404 })
	const viewerId = await getUserId(request)
	const collection = await prisma.mediaCollection.findFirst({
		where: visibleCollectionWhere(collectionId, viewerId),
		select: {
			id: true,
			title: true,
			description: true,
			isPublic: true,
			createdAt: true,
			updatedAt: true,
			ownerId: true,
			owner: { select: { username: true, name: true } },
			items: {
				orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
				select: {
					id: true,
					position: true,
					media: {
						select: {
							id: true,
							kind: true,
							title: true,
							type: true,
							thumbnail: true,
							description: true,
							releaseStart: true,
						},
					},
				},
			},
		},
	})
	invariantResponse(collection, 'Collection not found', { status: 404 })
	const isOwner = viewerId === collection.ownerId
	const query = isOwner
		? (new URL(request.url).searchParams.get('q')?.trim().slice(0, 100) ?? '')
		: ''
	const existingMediaIds = collection.items.map(item => item.media.id)
	const searchResults = query
		? await prisma.media.findMany({
				where: {
					id: existingMediaIds.length ? { notIn: existingMediaIds } : undefined,
					title: { contains: query },
				},
				orderBy: [{ title: 'asc' }, { id: 'asc' }],
				take: 12,
				select: {
					id: true,
					kind: true,
					title: true,
					type: true,
					thumbnail: true,
					description: true,
				},
			})
		: []
	return json({ collection, isOwner, query, searchResults })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const collection = await requireCollectionOwner(request, params.collectionId)
	const parsed = CollectionItemActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	invariantResponse(parsed.success, 'Invalid collection action', {
		status: 400,
	})
	if (parsed.data.intent === 'add-item') {
		await addCollectionItem({
			collectionId: collection.id,
			mediaId: parsed.data.mediaId,
		})
	} else if (parsed.data.intent === 'remove-item') {
		await removeCollectionItem({
			collectionId: collection.id,
			itemId: parsed.data.itemId,
		})
	} else {
		await moveCollectionItem({
			collectionId: collection.id,
			itemId: parsed.data.itemId,
			direction: parsed.data.direction,
		})
	}
	return redirect(`/collections/${collection.id}`, { status: 303 })
}

function mediaYear(value: Date | string | null) {
	return value ? new Date(value).getUTCFullYear() : null
}

export default function CollectionDetail() {
	const data = useLoaderData<typeof loader>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'
	return (
		<main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 text-[#ffefcc] sm:px-6 lg:px-8">
			<header className="space-y-5 rounded-2xl border border-[#54806c] bg-[#383040] p-6">
				<div className="flex flex-wrap items-start justify-between gap-5">
					<div className="max-w-3xl space-y-2">
						<div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#a2ffd5]">
							<span>
								{data.collection.items.length}{' '}
								{data.collection.items.length === 1 ? 'title' : 'titles'}
							</span>
							{!data.collection.isPublic ? (
								<span className="rounded-full border border-[#ffcc66] px-2 py-0.5 text-[#ffcc66]">
									Private
								</span>
							) : null}
						</div>
						<h1 className="text-4xl font-black text-[#ff9900]">
							{data.collection.title}
						</h1>
						<p className="text-sm text-[#a2ffd5]">
							by{' '}
							<Link
								className="font-bold underline"
								to={`/users/${data.collection.owner.username}/collections`}
							>
								{data.collection.owner.name ?? data.collection.owner.username}
							</Link>
						</p>
					</div>
					{data.isOwner ? (
						<Button asChild variant="outline">
							<Link to="edit">Edit collection</Link>
						</Button>
					) : null}
				</div>
				{data.collection.description ? (
					<p className="whitespace-pre-wrap leading-7 text-[#c6ded2]">
						{data.collection.description}
					</p>
				) : null}
			</header>

			{data.isOwner ? (
				<section className="space-y-4 rounded-2xl border border-[#54806c] bg-[#383040] p-5">
					<div>
						<h2 className="text-xl font-black text-[#ffffb1]">Add a title</h2>
						<p className="text-sm text-[#c6ded2]">
							Search the canonical catalog, then add any result.
						</p>
					</div>
					<Form method="get" className="flex items-end gap-3">
						<div className="flex-1 space-y-2">
							<Label htmlFor="media-query">Title</Label>
							<Input
								id="media-query"
								name="q"
								defaultValue={data.query}
								placeholder="Search media"
								maxLength={100}
							/>
						</div>
						<Button type="submit" variant="outline">
							Search
						</Button>
					</Form>
					{data.query ? (
						data.searchResults.length ? (
							<div className="grid gap-3 md:grid-cols-2">
								{data.searchResults.map(media => {
									const poster = splitLegacyThumbnail(media.thumbnail).imageUrl
									return (
										<article
											key={media.id}
											className="flex gap-3 rounded-xl bg-[#2e2f2b] p-3"
										>
											{poster ? (
												<img
													src={poster}
													alt=""
													className="h-20 w-14 rounded object-cover"
												/>
											) : (
												<div className="h-20 w-14 rounded bg-[#383040]" />
											)}
											<div className="min-w-0 flex-1">
												<Link
													to={`/media/${media.id}`}
													className="font-bold text-[#ffffb1] hover:underline"
												>
													{media.title?.trim() || `Untitled ${media.kind}`}
												</Link>
												<p className="text-xs uppercase text-[#a2ffd5]">
													{media.type || media.kind}
												</p>
											</div>
											<Form method="post">
												<input type="hidden" name="intent" value="add-item" />
												<input type="hidden" name="mediaId" value={media.id} />
												<Button
													type="submit"
													size="sm"
													variant="outline"
													disabled={busy}
												>
													Add
												</Button>
											</Form>
										</article>
									)
								})}
							</div>
						) : (
							<p className="text-sm text-[#a2ffd5]">
								No additional titles match “{data.query}”.
							</p>
						)
					) : null}
				</section>
			) : null}

			<section className="space-y-4">
				<h2 className="text-2xl font-black text-[#ffffb1]">The list</h2>
				{data.collection.items.length ? (
					<ol className="space-y-3">
						{data.collection.items.map((item, index) => {
							const poster = splitLegacyThumbnail(item.media.thumbnail).imageUrl
							const year = mediaYear(item.media.releaseStart)
							return (
								<li
									key={item.id}
									className="flex gap-4 rounded-2xl border border-[#54806c] bg-[#383040] p-4"
								>
									<div className="flex w-9 shrink-0 items-center justify-center text-2xl font-black text-[#ff9900]">
										{index + 1}
									</div>
									{poster ? (
										<img
											src={poster}
											alt=""
											loading="lazy"
											className="h-28 w-20 shrink-0 rounded-lg object-cover"
										/>
									) : (
										<div className="h-28 w-20 shrink-0 rounded-lg bg-[#2e2f2b]" />
									)}
									<div className="min-w-0 flex-1">
										<p className="text-xs font-bold uppercase tracking-wide text-[#a2ffd5]">
											{item.media.type || item.media.kind}
											{year ? ` · ${year}` : ''}
										</p>
										<h3 className="mt-1 text-xl font-black text-[#ffffb1]">
											<Link
												to={`/media/${item.media.id}`}
												className="hover:underline"
											>
												{item.media.title?.trim() ||
													`Untitled ${item.media.kind}`}
											</Link>
										</h3>
										{item.media.description ? (
											<p className="mt-2 line-clamp-2 text-sm leading-6 text-[#c6ded2]">
												{item.media.description}
											</p>
										) : null}
									</div>
									{data.isOwner ? (
										<div className="flex shrink-0 flex-col gap-2">
											<Form method="post">
												<input type="hidden" name="intent" value="move-item" />
												<input type="hidden" name="itemId" value={item.id} />
												<input type="hidden" name="direction" value="up" />
												<Button
													type="submit"
													size="sm"
													variant="outline"
													disabled={busy || index === 0}
													aria-label={`Move ${item.media.title ?? 'title'} up`}
												>
													↑
												</Button>
											</Form>
											<Form method="post">
												<input type="hidden" name="intent" value="move-item" />
												<input type="hidden" name="itemId" value={item.id} />
												<input type="hidden" name="direction" value="down" />
												<Button
													type="submit"
													size="sm"
													variant="outline"
													disabled={
														busy || index === data.collection.items.length - 1
													}
													aria-label={`Move ${item.media.title ?? 'title'} down`}
												>
													↓
												</Button>
											</Form>
											<Form method="post">
												<input
													type="hidden"
													name="intent"
													value="remove-item"
												/>
												<input type="hidden" name="itemId" value={item.id} />
												<Button
													type="submit"
													size="sm"
													variant="destructive"
													disabled={busy}
													aria-label={`Remove ${item.media.title ?? 'title'}`}
												>
													×
												</Button>
											</Form>
										</div>
									) : null}
								</li>
							)
						})}
					</ol>
				) : (
					<div className="rounded-2xl border border-dashed border-[#54806c] bg-[#383040] px-6 py-14 text-center">
						<h3 className="text-xl font-black text-[#ffffb1]">
							This collection is empty
						</h3>
						<p className="mt-2 text-[#a2ffd5]">
							{data.isOwner
								? 'Search above to add its first title.'
								: 'The curator has not added any titles yet.'}
						</p>
					</div>
				)}
			</section>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
	{ title: data ? `${data.collection.title} · Veud` : 'Collection · Veud' },
	{
		name: 'description',
		content:
			data?.collection.description ?? 'A curated media collection on Veud.',
	},
]

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{ 404: () => <p>Collection not found.</p> }}
		/>
	)
}
