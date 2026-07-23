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
import { ReportContentButton } from '#app/components/report-content-button.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	addCollectionItem,
	collectionTagCreateData,
	moveCollectionItem,
	removeCollectionItem,
	updateCollectionItemNote,
	visibleCollectionWhere,
} from '#app/utils/media-collections.server.ts'
import {
	COLLECTION_COMMENT_MAX_LENGTH,
	COLLECTION_ITEM_NOTE_MAX_LENGTH,
	COLLECTION_TITLE_MAX_LENGTH,
} from '#app/utils/media-collections.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'

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
	z.object({ intent: z.literal('like-toggle') }),
	z.object({ intent: z.literal('feature-toggle') }),
	z.object({
		intent: z.literal('note-item'),
		itemId: z.string().min(1).max(100),
		note: z
			.string()
			.trim()
			.max(COLLECTION_ITEM_NOTE_MAX_LENGTH)
			.transform(value => value || null),
	}),
	z.object({
		intent: z.literal('comment-create'),
		body: z.string().trim().min(1).max(COLLECTION_COMMENT_MAX_LENGTH),
	}),
	z.object({
		intent: z.literal('comment-delete'),
		commentId: z.string().min(1).max(100),
	}),
	z.object({ intent: z.literal('clone') }),
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
			featuredAt: true,
			createdAt: true,
			updatedAt: true,
			ownerId: true,
			owner: { select: { id: true, username: true, name: true } },
			tags: {
				orderBy: { tag: { name: 'asc' } },
				select: { tag: { select: { name: true, slug: true } } },
			},
			_count: {
				select: {
					likes: true,
					comments: { where: { moderationStatus: 'visible' } },
				},
			},
			likes: {
				where: { userId: viewerId ?? '' },
				take: 1,
				select: { id: true },
			},
			comments: {
				where: { moderationStatus: 'visible' },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				take: 100,
				select: {
					id: true,
					body: true,
					createdAt: true,
					author: {
						select: { id: true, username: true, name: true },
					},
				},
			},
			items: {
				orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
				select: {
					id: true,
					position: true,
					note: true,
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
	const isAdmin = viewerId
		? Boolean(
				await prisma.user.findFirst({
					where: { id: viewerId, roles: { some: { name: 'admin' } } },
					select: { id: true },
				}),
			)
		: false
	const { likes, ...collectionData } = collection
	return json({
		collection: collectionData,
		isOwner,
		isAdmin,
		viewerId,
		viewerLiked: likes.length > 0,
		query,
		searchResults,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const parsed = CollectionItemActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	invariantResponse(parsed.success, 'Invalid collection action', {
		status: 400,
	})
	const userId = await requireUserId(request)
	const collectionId = params.collectionId
	invariantResponse(collectionId, 'Collection not found', { status: 404 })
	const collection = await prisma.mediaCollection.findFirst({
		where: visibleCollectionWhere(collectionId, userId),
		select: {
			id: true,
			title: true,
			description: true,
			isPublic: true,
			featuredAt: true,
			ownerId: true,
			tags: {
				select: { tag: { select: { name: true, slug: true } } },
			},
			items: {
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				select: { mediaId: true, position: true, note: true },
			},
		},
	})
	invariantResponse(collection, 'Collection not found', { status: 404 })

	if (parsed.data.intent === 'add-item') {
		invariantResponse(collection.ownerId === userId, 'Collection not found', {
			status: 404,
		})
		await addCollectionItem({
			collectionId: collection.id,
			mediaId: parsed.data.mediaId,
		})
	} else if (parsed.data.intent === 'remove-item') {
		invariantResponse(collection.ownerId === userId, 'Collection not found', {
			status: 404,
		})
		await removeCollectionItem({
			collectionId: collection.id,
			itemId: parsed.data.itemId,
		})
	} else if (parsed.data.intent === 'move-item') {
		invariantResponse(collection.ownerId === userId, 'Collection not found', {
			status: 404,
		})
		await moveCollectionItem({
			collectionId: collection.id,
			itemId: parsed.data.itemId,
			direction: parsed.data.direction,
		})
	} else if (parsed.data.intent === 'like-toggle') {
		await prisma.$transaction(async transaction => {
			const existing = await transaction.collectionLike.findUnique({
				where: {
					userId_collectionId: { userId, collectionId: collection.id },
				},
				select: { id: true },
			})
			if (existing) {
				await transaction.collectionLike.delete({ where: { id: existing.id } })
				return
			}
			const like = await transaction.collectionLike.create({
				data: { userId, collectionId: collection.id },
				select: { id: true },
			})
			if (collection.ownerId !== userId) {
				await transaction.notification.create({
					data: {
						type: 'collection_like',
						recipientId: collection.ownerId,
						actorId: userId,
						collectionId: collection.id,
						collectionLikeId: like.id,
					},
				})
			}
		})
	} else if (parsed.data.intent === 'feature-toggle') {
		await requireUserWithRole(request, 'admin')
		invariantResponse(collection.isPublic, 'Collection not found', {
			status: 404,
		})
		await prisma.mediaCollection.update({
			where: { id: collection.id },
			data: { featuredAt: collection.featuredAt ? null : new Date() },
		})
	} else if (parsed.data.intent === 'note-item') {
		invariantResponse(collection.ownerId === userId, 'Collection not found', {
			status: 404,
		})
		await updateCollectionItemNote({
			collectionId: collection.id,
			itemId: parsed.data.itemId,
			note: parsed.data.note,
		})
	} else if (parsed.data.intent === 'comment-create') {
		const body = parsed.data.body
		await prisma.$transaction(async transaction => {
			const comment = await transaction.collectionComment.create({
				data: {
					authorId: userId,
					collectionId: collection.id,
					body,
				},
				select: { id: true },
			})
			if (collection.ownerId !== userId) {
				await transaction.notification.create({
					data: {
						type: 'collection_comment',
						recipientId: collection.ownerId,
						actorId: userId,
						collectionId: collection.id,
						collectionCommentId: comment.id,
					},
				})
			}
		})
	} else if (parsed.data.intent === 'comment-delete') {
		const comment = await prisma.collectionComment.findFirst({
			where: { id: parsed.data.commentId, collectionId: collection.id },
			select: { id: true, authorId: true },
		})
		invariantResponse(
			comment && (comment.authorId === userId || collection.ownerId === userId),
			'Comment not found',
			{ status: 404 },
		)
		await prisma.collectionComment.delete({ where: { id: comment.id } })
	} else {
		const suffix = ' (copy)'
		const clone = await prisma.mediaCollection.create({
			data: {
				ownerId: userId,
				title: `${collection.title.slice(0, COLLECTION_TITLE_MAX_LENGTH - suffix.length)}${suffix}`,
				description: collection.description,
				isPublic: false,
				items: {
					create: collection.items.map(item => ({
						mediaId: item.mediaId,
						position: item.position,
						note: item.note,
					})),
				},
				tags: {
					create: collectionTagCreateData(
						collection.tags.map(({ tag }) => tag),
					),
				},
			},
			select: { id: true },
		})
		return redirect(`/collections/${clone.id}`, { status: 303 })
	}
	return redirect(`/collections/${collection.id}`, { status: 303 })
}

function mediaYear(value: Date | string | null) {
	return value ? new Date(value).getUTCFullYear() : null
}

function displayDateTime(value: Date | string) {
	return new Date(value).toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	})
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
							<span>· {data.collection._count.likes} likes</span>
							<span>· {data.collection._count.comments} comments</span>
							{!data.collection.isPublic ? (
								<span className="rounded-full border border-[#ffcc66] px-2 py-0.5 text-[#ffcc66]">
									Private
								</span>
							) : null}
							{data.collection.featuredAt ? (
								<span className="rounded-full border border-[#ff9900] px-2 py-0.5 text-[#ffffb1]">
									Staff pick
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
					<div className="flex flex-wrap gap-2">
						{data.viewerId ? (
							<>
								<Form method="post">
									<Button
										type="submit"
										name="intent"
										value="like-toggle"
										variant={data.viewerLiked ? 'default' : 'outline'}
										disabled={busy}
									>
										{data.viewerLiked ? 'Unlike' : 'Like'}
									</Button>
								</Form>
								<Form method="post">
									<Button
										type="submit"
										name="intent"
										value="clone"
										variant="outline"
										disabled={busy}
									>
										Clone
									</Button>
								</Form>
							</>
						) : (
							<Button asChild variant="outline">
								<Link
									to={`/login?redirectTo=${encodeURIComponent(`/collections/${data.collection.id}`)}`}
								>
									Log in to engage
								</Link>
							</Button>
						)}
						{data.isOwner ? (
							<Button asChild variant="outline">
								<Link to="edit">Edit collection</Link>
							</Button>
						) : null}
						{data.viewerId && !data.isOwner ? (
							<ReportContentButton
								targetType="collection"
								targetId={data.collection.id}
								label="collection"
							/>
						) : null}
						{data.isAdmin && data.collection.isPublic ? (
							<Form method="post">
								<Button
									type="submit"
									name="intent"
									value="feature-toggle"
									variant="outline"
									disabled={busy}
								>
									{data.collection.featuredAt
										? 'Remove staff pick'
										: 'Feature as staff pick'}
								</Button>
							</Form>
						) : null}
					</div>
				</div>
				{data.collection.description ? (
					<p className="whitespace-pre-wrap leading-7 text-[#c6ded2]">
						{data.collection.description}
					</p>
				) : null}
				{data.collection.tags.length ? (
					<nav aria-label="Collection tags" className="flex flex-wrap gap-2">
						{data.collection.tags.map(({ tag }) => (
							<Link
								key={tag.slug}
								to={`/collections?tag=${encodeURIComponent(tag.slug)}`}
								className="rounded-full border border-[#54806c] bg-[#2e2f2b] px-3 py-1 text-xs font-bold text-[#a2ffd5] hover:border-[#a2ffd5]"
							>
								#{tag.name}
							</Link>
						))}
					</nav>
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
										{item.note ? (
											<blockquote className="mt-3 border-l-2 border-[#ff9900] pl-3 text-sm italic leading-6 text-[#ffefcc]">
												{item.note}
											</blockquote>
										) : null}
										{data.isOwner ? (
											<details className="mt-3 text-sm">
												<summary className="cursor-pointer font-bold text-[#a2ffd5]">
													{item.note ? 'Edit curator note' : 'Add curator note'}
												</summary>
												<Form method="post" className="mt-3 space-y-2">
													<input
														type="hidden"
														name="intent"
														value="note-item"
													/>
													<input type="hidden" name="itemId" value={item.id} />
													<Label htmlFor={`item-note-${item.id}`}>
														Why does this title belong here?
													</Label>
													<Textarea
														id={`item-note-${item.id}`}
														name="note"
														defaultValue={item.note ?? ''}
														maxLength={COLLECTION_ITEM_NOTE_MAX_LENGTH}
														rows={3}
													/>
													<Button
														type="submit"
														size="sm"
														variant="outline"
														disabled={busy}
													>
														Save note
													</Button>
												</Form>
											</details>
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

			<section
				id="discussion"
				className="space-y-5 rounded-2xl border border-[#54806c] bg-[#383040] p-6"
			>
				<header>
					<h2 className="text-2xl font-black text-[#ffffb1]">Discussion</h2>
					<p className="mt-1 text-sm text-[#a2ffd5]">
						{data.collection._count.comments}{' '}
						{data.collection._count.comments === 1 ? 'comment' : 'comments'}
					</p>
				</header>
				{data.viewerId ? (
					<Form method="post" className="space-y-3">
						<input type="hidden" name="intent" value="comment-create" />
						<Label htmlFor="collection-comment">Add a comment</Label>
						<Textarea
							id="collection-comment"
							name="body"
							maxLength={COLLECTION_COMMENT_MAX_LENGTH}
							required
							rows={4}
							placeholder="Share your thoughts on this collection…"
						/>
						<Button type="submit" disabled={busy}>
							Post comment
						</Button>
					</Form>
				) : (
					<p className="text-sm text-[#c6ded2]">
						<Link
							to={`/login?redirectTo=${encodeURIComponent(`/collections/${data.collection.id}#discussion`)}`}
							className="font-bold underline"
						>
							Log in
						</Link>{' '}
						to join the discussion.
					</p>
				)}

				{data.collection.comments.length ? (
					<ul className="space-y-3">
						{data.collection.comments.map(comment => (
							<li
								key={comment.id}
								id={`collection-comment-${comment.id}`}
								className="rounded-xl bg-[#2e2f2b] p-4"
							>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<Link
											to={`/users/${comment.author.username}`}
											className="font-bold text-[#ffffb1] hover:underline"
										>
											{comment.author.name ?? comment.author.username}
										</Link>
										<time className="ml-2 text-xs text-[#8ca99d]">
											{displayDateTime(comment.createdAt)}
										</time>
									</div>
									{data.viewerId === comment.author.id || data.isOwner ? (
										<Form method="post">
											<input
												type="hidden"
												name="intent"
												value="comment-delete"
											/>
											<input
												type="hidden"
												name="commentId"
												value={comment.id}
											/>
											<button
												type="submit"
												disabled={busy}
												className="text-xs font-bold text-red-300 hover:underline disabled:opacity-50"
											>
												Delete
											</button>
										</Form>
									) : data.viewerId ? (
										<ReportContentButton
											targetType="collection_comment"
											targetId={comment.id}
											label="collection comment"
										/>
									) : null}
								</div>
								<p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#c6ded2]">
									{comment.body}
								</p>
							</li>
						))}
					</ul>
				) : (
					<p className="rounded-xl bg-[#2e2f2b] p-5 text-sm text-[#a2ffd5]">
						No comments yet.
					</p>
				)}
				{data.collection._count.comments > data.collection.comments.length ? (
					<p className="text-xs text-[#8ca99d]">
						Showing the first {data.collection.comments.length} comments.
					</p>
				) : null}
			</section>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
	{
		title: loaderData
			? `${loaderData.collection.title} · Veud`
			: 'Collection · Veud',
	},
	{
		name: 'description',
		content:
			loaderData?.collection.description ??
			'A curated media collection on Veud.',
	},
]

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{ 404: () => <p>Collection not found.</p> }}
		/>
	)
}
