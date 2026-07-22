import {
	data as json,
	Form,
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
	useLocation,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
} from '#app/components/ui/veud-layout.tsx'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { REVIEW_COMMENT_MAX_LENGTH } from '#app/utils/media-journal.ts'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import {
	getReviewDiscoveryResults,
	parseReviewDiscoveryQuery,
	type ReviewDiscoveryQuery,
} from '#app/utils/review-discovery.server.ts'
import {
	createReviewComment,
	toggleReviewLike,
} from '#app/utils/review-engagement.server.ts'

const ReviewHubActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('review-like-toggle'),
		reviewId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('review-comment-create'),
		reviewId: z.string().min(1).max(100),
		body: z.string().trim().min(1).max(REVIEW_COMMENT_MAX_LENGTH),
	}),
])

const kindLabels: Record<ReviewDiscoveryQuery['kind'], string> = {
	all: 'All media',
	movie: 'Movies',
	tv: 'TV',
	anime: 'Anime',
	manga: 'Manga',
}

const sortLabels: Record<ReviewDiscoveryQuery['sort'], string> = {
	trending: 'Trending',
	popular: 'Most liked',
	recent: 'Recently published',
	following: 'From people you follow',
}

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const filters = parseReviewDiscoveryQuery(new URL(request.url).searchParams)
	return json({
		...(await getReviewDiscoveryResults(filters, viewerId)),
		isSignedIn: Boolean(viewerId),
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const parsed = ReviewHubActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		throw new Response('Invalid review action', { status: 400 })
	}

	const result = await prisma.$transaction(async tx => {
		if (parsed.data.intent === 'review-like-toggle') {
			return await toggleReviewLike(tx, {
				userId,
				reviewId: parsed.data.reviewId,
			})
		}
		return await createReviewComment(tx, {
			userId,
			reviewId: parsed.data.reviewId,
			body: parsed.data.body,
		})
	})
	return json({ ok: true, ...result })
}

function reviewDiscoveryHref(filters: ReviewDiscoveryQuery, page: number) {
	const searchParams = new URLSearchParams()
	if (filters.q) searchParams.set('q', filters.q)
	if (filters.kind !== 'all') searchParams.set('kind', filters.kind)
	if (filters.sort !== 'trending') searchParams.set('sort', filters.sort)
	if (filters.spoilers === 'exclude') {
		searchParams.set('spoilers', 'exclude')
	}
	if (page > 1) searchParams.set('page', String(page))
	const search = searchParams.toString()
	return search ? `/reviews?${search}` : '/reviews'
}

function displayDate(value: Date | string) {
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

export default function ReviewsRoute() {
	const data = useLoaderData<typeof loader>()
	const location = useLocation()
	const navigation = useNavigation()
	const pendingReviewId = navigation.formData?.get('reviewId')
	const pendingIntent = navigation.formData?.get('intent')
	const loginHref = `/login?${new URLSearchParams({
		redirectTo: `${location.pathname}${location.search}`,
	})}`
	const filterKey = [
		data.filters.q,
		data.filters.kind,
		data.filters.sort,
		data.filters.spoilers,
	].join(':')

	return (
		<VeudPage>
			<VeudPageHeader
				eyebrow="Community criticism"
				title="Reviews"
				description={
					<p>
						Find thoughtful takes across movies, television, anime, and manga,
						then join the discussion on each title.
					</p>
				}
			/>

			<Form
				key={filterKey}
				method="get"
				className="grid gap-4 rounded-2xl border border-veud-border bg-veud-surface p-4 shadow-lg shadow-black/10 sm:p-5 md:grid-cols-2 lg:grid-cols-[minmax(16rem,2fr)_repeat(2,minmax(10rem,1fr))_auto] lg:items-end"
			>
				<div className="space-y-2">
					<Label htmlFor="review-query">Find reviews</Label>
					<Input
						id="review-query"
						name="q"
						defaultValue={data.filters.q}
						placeholder="Title, reviewer, or review text"
						maxLength={100}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="review-kind">Media type</Label>
					<select
						id="review-kind"
						name="kind"
						defaultValue={data.filters.kind}
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
					>
						{Object.entries(kindLabels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-2">
					<Label htmlFor="review-sort">Rank by</Label>
					<select
						id="review-sort"
						name="sort"
						defaultValue={data.filters.sort}
						className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
					>
						{Object.entries(sortLabels).map(([value, label]) =>
							value !== 'following' || data.isSignedIn ? (
								<option key={value} value={value}>
									{label}
								</option>
							) : null,
						)}
					</select>
				</div>
				<div className="flex flex-wrap items-center gap-3 lg:col-span-3">
					<label className="flex items-center gap-2 text-sm font-semibold text-[#c6ded2]">
						<input
							type="checkbox"
							name="spoilers"
							value="exclude"
							defaultChecked={data.filters.spoilers === 'exclude'}
							className="h-4 w-4"
						/>
						Spoiler-free reviews only
					</label>
				</div>
				<div className="flex gap-2 lg:justify-end">
					<Button type="submit">Browse</Button>
					<Button asChild type="button" variant="ghost">
						<Link to="/reviews">Clear</Link>
					</Button>
				</div>
			</Form>

			<section className="space-y-4" aria-labelledby="review-results-heading">
				<header className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2
							id="review-results-heading"
							className="text-2xl font-black text-[#ffffb1]"
						>
							{sortLabels[data.filters.sort]} reviews
						</h2>
						{data.filters.sort === 'following' ? (
							<p className="mt-1 text-sm text-[#a2ffd5]">
								The latest criticism from members you follow.
							</p>
						) : null}
					</div>
					<p className="text-sm font-semibold text-[#a2ffd5]">
						{data.total} {data.total === 1 ? 'review' : 'reviews'}
					</p>
				</header>

				{data.items.length ? (
					<div className="grid gap-5 lg:grid-cols-2">
						{data.items.map(review => {
							const poster = splitLegacyThumbnail(
								review.media.thumbnail,
							).imageUrl
							return (
								<article
									key={review.id}
									className="flex min-w-0 gap-4 rounded-2xl border border-[#54806c] bg-[#383040] p-5 transition hover:border-[#a2ffd5]"
								>
									<Link
										to={`/media/${review.media.id}#review-${review.id}`}
										className="hidden h-40 w-28 shrink-0 overflow-hidden rounded-lg bg-[#2e2f2b] sm:block"
									>
										{poster ? (
											<img
												src={poster}
												alt=""
												loading="lazy"
												className="h-full w-full object-cover"
											/>
										) : null}
									</Link>
									<div className="min-w-0 flex-1 space-y-3">
										<header>
											<div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide text-[#a2ffd5]">
												<span>
													{review.media.type ||
														kindLabels[
															review.media.kind as ReviewDiscoveryQuery['kind']
														] ||
														review.media.kind}
												</span>
												{review.media.year ? (
													<span>· {review.media.year}</span>
												) : null}
												{review.rating !== null ? (
													<span className="text-[#ffcc66]">
														★ {review.rating}/10
													</span>
												) : null}
											</div>
											<h3 className="mt-1 text-xl font-black text-[#ffffb1]">
												<Link
													to={`/media/${review.media.id}#review-${review.id}`}
													className="hover:underline"
												>
													{review.media.title}
												</Link>
											</h3>
										</header>

										<div className="flex items-center gap-2 text-sm text-[#c6ded2]">
											<img
												src={getUserImgSrc(review.author.image?.id)}
												alt=""
												className="h-8 w-8 rounded-full border border-[#54806c] object-cover"
											/>
											<span>
												by{' '}
												<Link
													to={`/users/${review.author.username}`}
													className="font-bold text-[#ffffb1] hover:underline"
												>
													{review.author.name ?? review.author.username}
												</Link>
											</span>
											<span>·</span>
											<time>{displayDate(review.createdAt)}</time>
										</div>

										{review.containsSpoilers ? (
											<div className="rounded-lg border border-[#ffcc66]/60 bg-[#2e2f2b] p-3 text-sm text-[#ffcc66]">
												Contains spoilers. Open the title page to reveal this
												review.
											</div>
										) : (
											<p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-[#c6ded2]">
												{review.body}
											</p>
										)}

										<footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#54806c]/60 pt-3 text-sm text-[#a2ffd5]">
											<div className="flex items-center gap-3">
												{data.isSignedIn ? (
													<Form method="post">
														<input
															type="hidden"
															name="intent"
															value="review-like-toggle"
														/>
														<input
															type="hidden"
															name="reviewId"
															value={review.id}
														/>
														<Button
															type="submit"
															variant={
																review.viewerLiked ? 'secondary' : 'outline'
															}
															size="sm"
															disabled={
																navigation.state !== 'idle' &&
																pendingReviewId === review.id
															}
														>
															{review.viewerLiked ? 'Unlike' : 'Like'} ·{' '}
															{review.likeCount}
														</Button>
													</Form>
												) : (
													<Button asChild variant="outline" size="sm">
														<Link to={loginHref}>
															Like · {review.likeCount}
														</Link>
													</Button>
												)}
												<span>
													{review.commentCount}{' '}
													{review.commentCount === 1 ? 'comment' : 'comments'}
												</span>
											</div>
											<Link
												to={`/media/${review.media.id}#review-${review.id}`}
												className="font-bold text-[#ffffb1] hover:underline"
											>
												Read and discuss
											</Link>
										</footer>
										{review.containsSpoilers ? null : (
											<details className="rounded-lg border border-[#54806c]/60 bg-[#2e2f2b] p-3">
												<summary className="cursor-pointer text-sm font-bold text-[#ffffb1]">
													Quick discussion · {review.commentCount}
												</summary>
												<div className="mt-4 space-y-4">
													{review.recentComments.length ? (
														<div className="space-y-3">
															{review.recentComments.map(comment => (
																<div
																	key={comment.id}
																	className="rounded-lg border border-[#54806c]/50 bg-[#383040] p-3"
																>
																	<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#a2ffd5]">
																		<Link
																			to={`/users/${comment.author.username}`}
																			className="font-bold text-[#ffffb1] hover:underline"
																		>
																			{comment.author.name ??
																				comment.author.username}
																		</Link>
																		<time>
																			{displayDate(comment.createdAt)}
																		</time>
																	</div>
																	<p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#c6ded2]">
																		{comment.body}
																	</p>
																</div>
															))}
														</div>
													) : (
														<p className="text-sm text-[#a2ffd5]">
															No comments yet. Start the conversation.
														</p>
													)}
													{data.isSignedIn ? (
														<Form method="post" className="space-y-2">
															<input
																type="hidden"
																name="intent"
																value="review-comment-create"
															/>
															<input
																type="hidden"
																name="reviewId"
																value={review.id}
															/>
															<Textarea
																name="body"
																aria-label={`Comment on ${review.media.title}`}
																maxLength={REVIEW_COMMENT_MAX_LENGTH}
																rows={3}
																required
																placeholder="Join the discussion…"
															/>
															<Button
																type="submit"
																size="sm"
																disabled={
																	navigation.state !== 'idle' &&
																	pendingReviewId === review.id &&
																	pendingIntent === 'review-comment-create'
																}
															>
																Post comment
															</Button>
														</Form>
													) : (
														<p className="text-sm text-[#a2ffd5]">
															<Link
																to={loginHref}
																className="font-bold text-[#ffffb1] hover:underline"
															>
																Log in
															</Link>{' '}
															to join the discussion.
														</p>
													)}
													{review.commentCount >
													review.recentComments.length ? (
														<Link
															to={`/media/${review.media.id}#review-${review.id}`}
															className="inline-block text-sm font-bold text-[#ffffb1] hover:underline"
														>
															Continue the full thread
														</Link>
													) : null}
												</div>
											</details>
										)}
									</div>
								</article>
							)
						})}
					</div>
				) : (
					<VeudEmptyState
						title="No reviews found"
						action={
							<Button asChild variant="outline">
								<Link to="/reviews">Clear filters</Link>
							</Button>
						}
					>
						<p>
							Try a broader search, another media type, or a different view.
						</p>
					</VeudEmptyState>
				)}

				{data.pageCount > 1 ? (
					<nav
						aria-label="Review pages"
						className="flex items-center justify-center gap-4 pt-3"
					>
						{data.filters.page > 1 ? (
							<Button asChild variant="outline">
								<Link
									to={reviewDiscoveryHref(data.filters, data.filters.page - 1)}
								>
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
								<Link
									to={reviewDiscoveryHref(data.filters, data.filters.page + 1)}
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
		</VeudPage>
	)
}

export const meta: MetaFunction = () => [
	{ title: 'Reviews · Veud' },
	{
		name: 'description',
		content:
			'Browse community reviews of movies, television, anime, and manga.',
	},
]

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
