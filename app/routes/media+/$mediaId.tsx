import { invariantResponse } from '@epic-web/invariant'
import { type Prisma } from '@prisma/client'
import { useState } from 'react'
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
import { KeyCrew, TopBilledCast } from '#app/components/media-cast.tsx'
import { MediaFacts, MediaVideos } from '#app/components/media-facts.tsx'
import { ReportContentButton } from '#app/components/report-content-button.tsx'
import { ReviewEditor } from '#app/components/review-editor.tsx'
import {
	MoreCommentsButton,
	ReviewBody,
	type ReviewDetailComment,
} from '#app/components/review-expander.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import {
	getTrackingActivityState,
	recordTrackingActivityDiff,
} from '#app/utils/activity.server.ts'
import { activityEventLabel } from '#app/utils/activity.ts'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	authoritativeLegacyTrackingEntry,
	loadOwnerLegacyTrackingEntries,
	type LegacyTrackingEntry,
} from '#app/utils/legacy-tracking-entry.server.ts'
import { visibleActivityEventWhere } from '#app/utils/lists/visibility.server.ts'
import {
	mediaCatalogSelect,
	resolveMediaCatalog,
	TRUSTED_CATALOG_PROVENANCE_VERSION,
	type MediaCatalogSnapshot,
} from '#app/utils/media-catalog.ts'
import {
	getFollowedMediaTracking,
	getMediaCommunityStatistics,
} from '#app/utils/media-community.server.ts'
import { getMediaCreditsPreview } from '#app/utils/media-credits.server.ts'
import {
	externalMediaUrl,
	legacyProgressUpdate,
	listTypeNameForMediaKind,
	progressUnitsForMediaKind,
	splitLegacyThumbnail,
	totalFromLegacyCounter,
} from '#app/utils/media-detail.ts'
import { mediaFacts } from '#app/utils/media-facts.ts'
import { toggleMediaFavorite } from '#app/utils/media-favorites.server.ts'
import {
	journalTerms,
	parseDiaryDate,
	REVIEW_COMMENT_MAX_LENGTH,
	REVIEW_MAX_LENGTH,
} from '#app/utils/media-journal.ts'
import { getSimilarMediaRecommendations } from '#app/utils/media-recommendations.server.ts'
import { getMediaRelations } from '#app/utils/media-relations.server.ts'
import { getViewerTitleLanguage } from '#app/utils/media-title.server.ts'
import { resolveDisplayTitle } from '#app/utils/media-title.ts'
import { mediaVideoLinks } from '#app/utils/media-videos.ts'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import {
	getNextCanonicalReminderRelease,
	releaseReminderLeadMinutes,
	removeReleaseReminder,
	saveReleaseReminder,
	type ReleaseReminderLeadMinutes,
} from '#app/utils/release-reminders.server.ts'
import {
	createReviewComment,
	toggleReviewLike,
} from '#app/utils/review-engagement.server.ts'
import {
	displayComment,
	reviewExcerpt,
	REVIEW_COMMENT_PREVIEW,
	REVIEW_COMMENT_REMAINDER_LIMIT,
} from '#app/utils/review-excerpt.ts'
import {
	absoluteUrl,
	isoDate,
	openGraphType,
	originFromMatches,
	schemaTypeForKind,
	SITE_NAME,
	socialDescription,
	socialMeta,
	splitGenres,
	structuredData,
	withoutEmptyValues,
} from '#app/utils/seo.ts'
import { ensureTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import { trackingStateFromEntry } from '#app/utils/tracking-state.ts'
import { setMediaTrackingStatus } from '#app/utils/tracking-status.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

export const MEDIA_DETAIL_COLLECTION_LIMIT = 100

const OptionalRatingSchema = z.preprocess(
	value =>
		value === '' || value === null || value === undefined ? null : value,
	z.coerce.number().min(0.1).max(10).nullable(),
)

const ReminderLeadSchema = z.coerce
	.number()
	.int()
	.refine(value =>
		releaseReminderLeadMinutes.includes(value as ReleaseReminderLeadMinutes),
	)
	.transform(value => value as ReleaseReminderLeadMinutes)

const DiaryDateSchema = z.string().transform((value, context) => {
	const parsed = parseDiaryDate(value)
	if (!parsed) {
		context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' })
		return z.NEVER
	}
	return parsed
})

const ActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('status'),
		watchlistId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('score'),
		score: z.coerce.number().min(0).max(10),
	}),
	z.object({
		intent: z.literal('progress'),
		unit: z.enum(['episode', 'chapter', 'volume']),
		current: z.coerce.number().int().min(0).max(1_000_000),
	}),
	z.object({
		intent: z.literal('review-save'),
		body: z.string().trim().min(1).max(REVIEW_MAX_LENGTH),
		containsSpoilers: z
			.string()
			.optional()
			.transform(value => value === 'true' || value === 'on'),
		rating: OptionalRatingSchema,
	}),
	z.object({ intent: z.literal('review-delete') }),
	z.object({
		intent: z.literal('review-like-toggle'),
		reviewId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('review-comment-create'),
		reviewId: z.string().min(1).max(100),
		parentId: z
			.string()
			.max(100)
			.optional()
			.transform(value => value || null),
		body: z.string().trim().min(1).max(REVIEW_COMMENT_MAX_LENGTH),
	}),
	z.object({
		intent: z.literal('review-comment-delete'),
		commentId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('diary-create'),
		loggedOn: DiaryDateSchema,
		isRepeat: z
			.string()
			.optional()
			.transform(value => value === 'true' || value === 'on'),
		rating: OptionalRatingSchema,
	}),
	z.object({
		intent: z.literal('diary-delete'),
		diaryEntryId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('collection-add'),
		collectionId: z.string().min(1).max(100),
	}),
	z.object({ intent: z.literal('favorite-toggle') }),
	z.object({
		intent: z.literal('release-reminder-save'),
		leadMinutes: ReminderLeadSchema,
	}),
	z.object({ intent: z.literal('release-reminder-delete') }),
])

function progressTotal(entry: MediaCatalogSnapshot | undefined, unit: string) {
	if (unit === 'episode') return totalFromLegacyCounter(entry?.length)
	if (unit === 'chapter') return totalFromLegacyCounter(entry?.chapters)
	if (unit === 'volume') return totalFromLegacyCounter(entry?.volumes)
	return null
}

function progressLabel(unit: string) {
	if (unit === 'episode') return 'Episodes watched'
	if (unit === 'chapter') return 'Chapters read'
	if (unit === 'volume') return 'Volumes read'
	return `${unit} progress`
}

function displayDate(value: Date | string | null | undefined) {
	if (!value) return '—'
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
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

function displayDiaryDate(value: Date | string) {
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	})
}

function todayDateInput() {
	return new Date().toISOString().slice(0, 10)
}

function recommendationDiscoveryHref(kind: string, genre: string | undefined) {
	const search = new URLSearchParams({ kind })
	if (genre) search.set('genre', genre)
	return `/discover?${search.toString()}`
}

/** How a viewer gets access, in words rather than TMDB's field names. */
const OFFER_KIND_LABELS: Record<string, string> = {
	flatrate: 'Subscription',
	free: 'Free',
	ads: 'Free with ads',
	rent: 'Rent',
	buy: 'Buy',
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const mediaId = params.mediaId
	invariantResponse(mediaId, 'Media not found', { status: 404 })
	const viewerId = await getUserId(request)
	const titleLanguage = await getViewerTitleLanguage(request, viewerId)
	const media = await prisma.media.findUnique({
		where: { id: mediaId },
		select: {
			id: true,
			kind: true,
			_count: {
				select: {
					reviews: { where: { moderationStatus: 'visible' } },
					diaryEntries: true,
					favorites: true,
				},
			},
			...mediaCatalogSelect,
			externalIds: {
				select: { provider: true, kind: true, externalId: true },
				orderBy: [{ provider: 'asc' }, { externalId: 'asc' }],
			},
			watchAvailability: {
				where: { expiresAt: { gt: new Date() } },
				orderBy: [{ displayPriority: 'asc' }, { providerName: 'asc' }],
				select: {
					region: true,
					offerKind: true,
					providerName: true,
					link: true,
				},
			},
		},
	})
	if (!media) {
		const appliedMerge = await prisma.catalogMediaMerge.findFirst({
			where: {
				sourceMediaId: mediaId,
				status: 'applied',
				catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
			},
			select: { targetMediaId: true },
		})
		if (appliedMerge) {
			throw redirect(`/media/${appliedMerge.targetMediaId}`, 301)
		}
	}
	invariantResponse(media, 'Media not found', { status: 404 })

	const catalog = resolveMediaCatalog(media)
	const listTypeName = listTypeNameForMediaKind(media.kind)
	const viewerStatePromise = viewerId
		? prisma.trackingState.findUnique({
				where: {
					ownerId_mediaId: { ownerId: viewerId, mediaId: media.id },
				},
				select: {
					status: true,
					statusWatchlistId: true,
					score: true,
					startedAt: true,
					completedAt: true,
					repeatCount: true,
					progress: {
						select: { unit: true, current: true, total: true },
					},
				},
			})
		: Promise.resolve(null)
	const [
		community,
		credits,
		followedTracking,
		recommendations,
		relations,
		viewerState,
		legacyEntries,
		viewerWatchlists,
		activityRows,
		reviewRows,
		viewerReview,
		viewerDiaryEntries,
		viewerCollectionRows,
		viewerFavorite,
		viewerReminder,
	] = await Promise.all([
		getMediaCommunityStatistics(media.id),
		getMediaCreditsPreview(prisma, media.id),
		viewerId ? getFollowedMediaTracking(media.id, viewerId) : null,
		getSimilarMediaRecommendations(
			{ id: media.id, kind: media.kind, genres: catalog?.genres },
			viewerId,
		),
		getMediaRelations(media.id, viewerId),
		viewerStatePromise,
		viewerId
			? viewerStatePromise.then(state =>
					state
						? { entries: [], overflowed: false }
						: loadOwnerLegacyTrackingEntries(prisma, {
								ownerId: viewerId,
								mediaId: media.id,
							}),
				)
			: Promise.resolve({ entries: [], overflowed: false }),
		viewerId && listTypeName
			? prisma.watchlist.findMany({
					where: { ownerId: viewerId, type: { name: listTypeName } },
					select: { id: true, name: true, header: true, position: true },
					orderBy: [{ position: 'asc' }, { header: 'asc' }],
				})
			: [],
		prisma.activityEvent.findMany({
			where: {
				mediaId: media.id,
				AND: [visibleActivityEventWhere(viewerId)],
			},
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 20,
			select: {
				id: true,
				type: true,
				status: true,
				statusLabel: true,
				previousStatus: true,
				previousStatusLabel: true,
				score: true,
				previousScore: true,
				progressUnit: true,
				progressCurrent: true,
				progressPrevious: true,
				progressTotal: true,
				createdAt: true,
				actor: {
					select: { username: true },
				},
			},
		}),
		// Bodies are excerpted and comments previewed below, so this list stays a
		// list. The rest of any one review comes from /resources/review-detail.
		prisma.review.findMany({
			where: { mediaId: media.id, moderationStatus: 'visible' },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 20,
			select: {
				id: true,
				body: true,
				containsSpoilers: true,
				rating: true,
				createdAt: true,
				updatedAt: true,
				author: { select: { id: true, username: true } },
				_count: {
					select: {
						likes: true,
						comments: true,
					},
				},
				likes: {
					where: { userId: viewerId ?? '' },
					take: 1,
					select: { id: true },
				},
				comments: {
					// NOT filtered by moderation: the page renders removed comments as
					// tombstones, which tell a reader that something was there. They
					// therefore occupy a slot, and /resources/review-detail skips the
					// same unfiltered set when it resumes — see the note there.
					orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
					take: REVIEW_COMMENT_PREVIEW,
					select: {
						id: true,
						body: true,
						moderationStatus: true,
						parentId: true,
						createdAt: true,
						author: {
							select: { id: true, username: true },
						},
					},
				},
			},
		}),
		viewerId
			? prisma.review.findUnique({
					where: {
						authorId_mediaId: { authorId: viewerId, mediaId: media.id },
					},
					select: {
						id: true,
						body: true,
						containsSpoilers: true,
						rating: true,
						createdAt: true,
						updatedAt: true,
					},
				})
			: null,
		viewerId
			? prisma.diaryEntry.findMany({
					where: { ownerId: viewerId, mediaId: media.id },
					orderBy: [
						{ loggedOn: 'desc' },
						{ createdAt: 'desc' },
						{ id: 'desc' },
					],
					take: 20,
					select: {
						id: true,
						loggedOn: true,
						isRepeat: true,
						rating: true,
						createdAt: true,
					},
				})
			: [],
		viewerId
			? prisma.mediaCollection.findMany({
					where: { ownerId: viewerId },
					orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
					take: MEDIA_DETAIL_COLLECTION_LIMIT + 1,
					select: {
						id: true,
						title: true,
						_count: {
							select: {
								items: { where: { mediaId: media.id } },
							},
						},
					},
				})
			: [],
		viewerId
			? prisma.userFavorite.findFirst({
					where: { ownerId: viewerId, mediaId: media.id },
					select: { id: true },
				})
			: null,
		viewerId
			? prisma.releaseReminder.findUnique({
					where: {
						ownerId_mediaId: { ownerId: viewerId, mediaId: media.id },
					},
					select: { id: true, leadMinutes: true },
				})
			: null,
	])

	const legacyEntry = authoritativeLegacyTrackingEntry(
		legacyEntries.entries,
		media.kind,
	)
	const legacyTracking = legacyEntry
		? trackingStateFromEntry(legacyEntry, {
				status: legacyEntry.watchlist.name,
				statusWatchlistId: legacyEntry.watchlist.id,
				mediaKind: media.kind,
			})
		: null
	const tracking = viewerState
		? {
				status: viewerState.status,
				statusWatchlistId: viewerState.statusWatchlistId,
				score: viewerState.score ? Number(viewerState.score) : null,
				startedAt: viewerState.startedAt,
				completedAt: viewerState.completedAt,
				repeatCount: viewerState.repeatCount,
				progress: viewerState.progress,
			}
		: legacyTracking
			? {
					status: legacyTracking.status,
					statusWatchlistId: legacyTracking.statusWatchlistId,
					score: legacyTracking.score,
					startedAt: legacyTracking.startedAt,
					completedAt: legacyTracking.completedAt,
					repeatCount: legacyTracking.repeatCount,
					progress: legacyTracking.progress,
				}
			: null
	const progress = progressUnitsForMediaKind(media.kind).map(unit => {
		const saved = tracking?.progress.find(progress => progress.unit === unit)
		return {
			unit,
			current: saved?.current ?? 0,
			total: saved?.total ?? progressTotal(catalog, unit),
		}
	})
	const thumbnail = splitLegacyThumbnail(catalog?.thumbnail)
	const upcomingRelease = getNextCanonicalReminderRelease({
		kind: media.kind,
		releaseStart: catalog?.releaseStart ?? null,
		releaseEnd: catalog?.releaseEnd ?? null,
		releaseStatus: catalog?.releaseStatus ?? null,
		nextRelease: catalog?.nextRelease ?? null,
	})

	return json({
		media: {
			id: media.id,
			kind: media.kind,
			title: resolveDisplayTitle(
				{ kind: media.kind, ...catalog },
				titleLanguage,
			),
			type: catalog?.type,
			description: catalog?.description,
			genres: catalog?.genres,
			releaseStart: catalog?.releaseStart,
			releaseEnd: catalog?.releaseEnd,
			imageUrl: thumbnail.imageUrl,
			facts: mediaFacts(media.kind, catalog ?? {}),
			videos: mediaVideoLinks(catalog?.videos),
			upcomingRelease,
			// Availability is regional. Without a viewer region to work from, show
			// the one the data is densest for rather than inventing a preference.
			watchAvailability: (() => {
				const byRegion = new Map<string, typeof media.watchAvailability>()
				for (const offer of media.watchAvailability) {
					byRegion.set(offer.region, [
						...(byRegion.get(offer.region) ?? []),
						offer,
					])
				}
				const region =
					byRegion.get('US') ??
					[...byRegion.values()].sort(
						(first, second) => second.length - first.length,
					)[0]
				return (region ?? []).map(offer => ({
					offerKind: offer.offerKind,
					providerName: offer.providerName,
					link: offer.link,
				}))
			})(),
			externalLinks: media.externalIds
				.map(identity => ({
					...identity,
					url: externalMediaUrl(identity),
				}))
				.filter(link => link.url !== null),
		},
		community: {
			...community,
			reviews: media._count.reviews,
			diaryEntries: media._count.diaryEntries,
			favorites: media._count.favorites,
		},
		socialContext: followedTracking,
		credits,
		recommendations,
		relations,
		reviews: reviewRows.map(({ likes, comments, ...review }) => ({
			...review,
			// An excerpt, not the body. Twenty reviews at up to 5,000 characters
			// each is 100 KB of text on a page most visitors read the top of; the
			// rest of any one review comes from /resources/review-detail.
			body: reviewExcerpt(review.body).text,
			bodyTruncated: reviewExcerpt(review.body).truncated,
			rating: review.rating === null ? null : Number(review.rating),
			viewerLiked: likes.length > 0,
			comments: comments.map(displayComment),
		})),
		activity: activityRows.map(event => ({
			id: event.id,
			action: activityEventLabel(event),
			createdAt: event.createdAt,
			actor: event.actor,
		})),
		viewer: viewerId
			? {
					id: viewerId,
					isFavorite: Boolean(viewerFavorite),
					reminder: viewerReminder,
					tracking,
					watchlists: viewerWatchlists,
					progress,
					review: viewerReview
						? {
								...viewerReview,
								rating:
									viewerReview.rating === null
										? null
										: Number(viewerReview.rating),
							}
						: null,
					diaryEntries: viewerDiaryEntries.map(entry => ({
						...entry,
						rating: entry.rating === null ? null : Number(entry.rating),
					})),
					collections: viewerCollectionRows
						.slice(0, MEDIA_DETAIL_COLLECTION_LIMIT)
						.map(({ _count, ...collection }) => ({
							...collection,
							containsMedia: _count.items > 0,
						})),
					collectionsTruncated:
						viewerCollectionRows.length > MEDIA_DETAIL_COLLECTION_LIMIT,
				}
			: null,
	})
}

// The same shape whether it came with the page or from the detail endpoint —
// they land in one thread, so one type keeps them from drifting apart.
type ReviewCommentItem = ReviewDetailComment

function ReviewCommentForm({
	reviewId,
	parentId,
	busy,
}: {
	reviewId: string
	parentId?: string
	busy: boolean
}) {
	return (
		<Form method="post" className="space-y-2">
			<input type="hidden" name="intent" value="review-comment-create" />
			<input type="hidden" name="reviewId" value={reviewId} />
			{parentId ? (
				<input type="hidden" name="parentId" value={parentId} />
			) : null}
			<Textarea
				name="body"
				aria-label={parentId ? 'Reply' : 'Comment'}
				maxLength={REVIEW_COMMENT_MAX_LENGTH}
				rows={parentId ? 2 : 3}
				required
				placeholder={parentId ? 'Write a reply…' : 'Join the discussion…'}
			/>
			<Button type="submit" size="sm" disabled={busy}>
				{parentId ? 'Post reply' : 'Post comment'}
			</Button>
		</Form>
	)
}

function ReviewCommentThread({
	comments,
	parentId,
	reviewId,
	reviewAuthorId,
	viewerId,
	busy,
	depth = 0,
}: {
	comments: ReviewCommentItem[]
	parentId: string | null
	reviewId: string
	reviewAuthorId: string
	viewerId: string | null
	busy: boolean
	depth?: number
}) {
	const children = comments.filter(comment => comment.parentId === parentId)
	if (!children.length) return null

	return (
		<div className={depth ? 'ml-4 border-l pl-4 sm:ml-8' : 'space-y-3'}>
			{children.map(comment => (
				<div
					key={comment.id}
					id={`comment-${comment.id}`}
					className="space-y-2 rounded-lg border bg-background p-3"
				>
					<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
						<Link
							to={`/users/${comment.author.username}`}
							className="font-semibold hover:underline"
						>
							{comment.author.username}
						</Link>
						<time className="text-muted-foreground">
							{displayDate(comment.createdAt)}
						</time>
					</div>
					<p
						className={`whitespace-pre-wrap text-sm leading-6 text-muted-foreground ${
							comment.isRemoved ? 'italic' : ''
						}`}
					>
						{comment.body}
					</p>
					{viewerId && !comment.isRemoved ? (
						<div className="flex flex-wrap items-start gap-2">
							<details>
								<summary className="cursor-pointer text-xs font-semibold text-primary">
									Reply
								</summary>
								<div className="mt-2 min-w-64">
									<ReviewCommentForm
										reviewId={reviewId}
										parentId={comment.id}
										busy={busy}
									/>
								</div>
							</details>
							{viewerId === comment.author.id || viewerId === reviewAuthorId ? (
								<Form method="post">
									<input
										type="hidden"
										name="intent"
										value="review-comment-delete"
									/>
									<input type="hidden" name="commentId" value={comment.id} />
									<button
										type="submit"
										disabled={busy}
										className="text-xs font-semibold text-destructive disabled:opacity-50"
									>
										Delete
									</button>
								</Form>
							) : (
								<ReportContentButton
									targetType="review_comment"
									targetId={comment.id}
									label="review comment"
								/>
							)}
						</div>
					) : null}
					<ReviewCommentThread
						comments={comments}
						parentId={comment.id}
						reviewId={reviewId}
						reviewAuthorId={reviewAuthorId}
						viewerId={viewerId}
						busy={busy}
						depth={depth + 1}
					/>
				</div>
			))}
		</div>
	)
}

function ReviewDiscussion({
	reviewId,
	reviewAuthorId,
	comments,
	commentCount,
	viewerId,
	busy,
}: {
	reviewId: string
	reviewAuthorId: string
	comments: ReviewCommentItem[]
	commentCount: number
	viewerId: string | null
	busy: boolean
}) {
	// The remainder arrives on request and joins the same thread, so a late reply
	// nests under the comment it answers. Null until asked for — an empty array
	// is a real answer and must not read as "not loaded yet".
	const [extra, setExtra] = useState<ReviewCommentItem[] | null>(null)
	const shown = extra ? [...comments, ...extra] : comments
	// Exact, because both ends count a removed comment: the page spends a slot on
	// its tombstone and the endpoint skips it.
	const hidden = Math.max(0, commentCount - shown.length)
	// A full page is the endpoint's ceiling, not the end of the conversation.
	// Anything short of it is everything there was, so the count is only worth
	// reporting here.
	const capped =
		extra !== null && extra.length >= REVIEW_COMMENT_REMAINDER_LIMIT

	return (
		<div className="space-y-3 rounded-lg bg-muted/30 p-3">
			<div className="text-sm font-semibold">Discussion · {commentCount}</div>
			{viewerId ? (
				<ReviewCommentForm reviewId={reviewId} busy={busy} />
			) : (
				<p className="text-sm text-muted-foreground">
					<Link
						to="/login"
						className="font-semibold text-primary hover:underline"
					>
						Log in
					</Link>{' '}
					to join the discussion.
				</p>
			)}
			<ReviewCommentThread
				comments={shown}
				parentId={null}
				reviewId={reviewId}
				reviewAuthorId={reviewAuthorId}
				viewerId={viewerId}
				busy={busy}
			/>
			{capped ? (
				<p className="text-xs text-muted-foreground">
					Showing the first {shown.length} of {commentCount} comments.
				</p>
			) : (
				<MoreCommentsButton
					reviewId={reviewId}
					hidden={hidden}
					onLoaded={setExtra}
				/>
			)}
		</div>
	)
}

export async function action({ request, params }: ActionFunctionArgs) {
	const mediaId = params.mediaId
	invariantResponse(mediaId, 'Media not found', { status: 404 })
	const userId = await requireUserId(request)
	const parsed = ActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success)
		throw new Response('Invalid media update', { status: 400 })

	return prisma.$transaction(async tx => {
		if (
			parsed.data.intent === 'status' ||
			parsed.data.intent === 'score' ||
			parsed.data.intent === 'progress'
		) {
			await serializeUserLibraryMutation(tx, userId)
		}
		const media = await tx.media.findUnique({
			where: { id: mediaId },
			select: {
				id: true,
				kind: true,
				...mediaCatalogSelect,
			},
		})
		if (!media) {
			const appliedMerge = await tx.catalogMediaMerge.findFirst({
				where: {
					sourceMediaId: mediaId,
					status: 'applied',
					catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
				},
				select: { targetMediaId: true },
			})
			if (appliedMerge) {
				throw redirect(`/media/${appliedMerge.targetMediaId}`, 303)
			}
			throw new Response('Media not found', { status: 404 })
		}

		if (parsed.data.intent === 'review-save') {
			const review = await tx.review.upsert({
				where: { authorId_mediaId: { authorId: userId, mediaId } },
				update: {
					body: parsed.data.body,
					containsSpoilers: parsed.data.containsSpoilers,
					rating: parsed.data.rating,
				},
				create: {
					authorId: userId,
					mediaId,
					body: parsed.data.body,
					containsSpoilers: parsed.data.containsSpoilers,
					rating: parsed.data.rating,
				},
				select: { id: true },
			})
			return json({ ok: true, reviewId: review.id })
		}

		if (parsed.data.intent === 'review-delete') {
			const deleted = await tx.review.deleteMany({
				where: { authorId: userId, mediaId },
			})
			if (!deleted.count)
				throw new Response('Review not found', { status: 404 })
			return json({ ok: true })
		}

		if (parsed.data.intent === 'review-like-toggle') {
			const result = await toggleReviewLike(tx, {
				userId,
				reviewId: parsed.data.reviewId,
				mediaId,
			})
			return json({ ok: true, ...result })
		}

		if (parsed.data.intent === 'review-comment-create') {
			const result = await createReviewComment(tx, {
				userId,
				reviewId: parsed.data.reviewId,
				parentId: parsed.data.parentId,
				body: parsed.data.body,
				mediaId,
			})
			return json({ ok: true, ...result })
		}

		if (parsed.data.intent === 'review-comment-delete') {
			const comment = await tx.reviewComment.findFirst({
				where: { id: parsed.data.commentId, review: { mediaId } },
				select: {
					id: true,
					authorId: true,
					review: { select: { authorId: true } },
				},
			})
			if (
				!comment ||
				(comment.authorId !== userId && comment.review.authorId !== userId)
			) {
				throw new Response('Comment not found', { status: 404 })
			}
			await tx.reviewComment.delete({ where: { id: comment.id } })
			return json({ ok: true })
		}

		if (parsed.data.intent === 'diary-create') {
			const entry = await tx.diaryEntry.create({
				data: {
					ownerId: userId,
					mediaId,
					loggedOn: parsed.data.loggedOn,
					isRepeat: parsed.data.isRepeat,
					rating: parsed.data.rating,
				},
				select: { id: true },
			})
			return json({ ok: true, diaryEntryId: entry.id })
		}

		if (parsed.data.intent === 'diary-delete') {
			const deleted = await tx.diaryEntry.deleteMany({
				where: {
					id: parsed.data.diaryEntryId,
					ownerId: userId,
					mediaId,
				},
			})
			if (!deleted.count)
				throw new Response('Diary entry not found', { status: 404 })
			return json({ ok: true })
		}

		if (parsed.data.intent === 'collection-add') {
			const collection = await tx.mediaCollection.findFirst({
				where: { id: parsed.data.collectionId, ownerId: userId },
				select: { id: true },
			})
			if (!collection)
				throw new Response('Collection not found', { status: 404 })
			const existing = await tx.mediaCollectionItem.findUnique({
				where: {
					collectionId_mediaId: { collectionId: collection.id, mediaId },
				},
				select: { id: true },
			})
			if (!existing) {
				const highest = await tx.mediaCollectionItem.aggregate({
					where: { collectionId: collection.id },
					_max: { position: true },
				})
				await tx.mediaCollectionItem.create({
					data: {
						collectionId: collection.id,
						mediaId,
						position: (highest._max.position ?? 0) + 1,
					},
				})
				await tx.mediaCollection.update({
					where: { id: collection.id },
					data: { updatedAt: new Date() },
				})
			}
			return json({ ok: true, collectionId: collection.id })
		}

		if (parsed.data.intent === 'favorite-toggle') {
			const catalog = resolveMediaCatalog(media)
			const favorite = await toggleMediaFavorite(tx, {
				ownerId: userId,
				mediaId,
				kind: media.kind,
				catalog,
			})
			return json({ ok: true, ...favorite })
		}

		if (parsed.data.intent === 'release-reminder-save') {
			const reminder = await saveReleaseReminder(tx, {
				ownerId: userId,
				mediaId,
				leadMinutes: parsed.data.leadMinutes,
			})
			return json({ ok: true, reminderId: reminder.id })
		}

		if (parsed.data.intent === 'release-reminder-delete') {
			await removeReleaseReminder(tx, { ownerId: userId, mediaId })
			return json({ ok: true })
		}

		if (parsed.data.intent === 'status') {
			const tracking = await setMediaTrackingStatus(tx, {
				ownerId: userId,
				mediaId,
				watchlistId: parsed.data.watchlistId,
			})
			return json({ ok: true, tracking })
		}

		const listTypeName = listTypeNameForMediaKind(media.kind)
		if (!listTypeName)
			throw new Response('Unsupported media kind', { status: 400 })
		const catalog = resolveMediaCatalog(media)
		let state = await tx.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId: userId, mediaId } },
			select: { id: true, statusWatchlistId: true },
		})
		let legacyResult:
			Awaited<ReturnType<typeof loadOwnerLegacyTrackingEntries>> | undefined
		let primary: LegacyTrackingEntry | undefined
		const loadPrimary = async () => {
			legacyResult ??= await loadOwnerLegacyTrackingEntries(tx, {
				ownerId: userId,
				mediaId,
			})
			if (legacyResult.overflowed) {
				throw new Response('Tracking data needs repair before editing', {
					status: 409,
				})
			}
			return authoritativeLegacyTrackingEntry(
				legacyResult.entries,
				media.kind,
				state?.statusWatchlistId,
			)
		}
		if (!state) {
			primary = await loadPrimary()
			if (!primary) {
				throw new Response('Choose a status before editing tracking data', {
					status: 400,
				})
			}
			const stateId = await ensureTrackingStateForEntry(tx, {
				ownerId: userId,
				mediaId,
				mediaKind: media.kind,
				status: primary.watchlist.name,
				statusWatchlistId: primary.watchlist.id,
				entry: primary,
				mode: 'all',
				recordActivity: true,
			})
			state = { id: stateId, statusWatchlistId: primary.watchlist.id }
		}
		await tx.entry.updateMany({
			where: { mediaId, watchlist: { ownerId: userId } },
			data: { trackingStateId: state.id },
		})

		if (parsed.data.intent === 'score') {
			const before = await getTrackingActivityState(tx, userId, mediaId)
			await tx.trackingState.update({
				where: { id: state.id },
				data: { score: parsed.data.score > 0 ? parsed.data.score : null },
			})
			await tx.entry.updateMany({
				where: { mediaId, watchlist: { ownerId: userId } },
				data: { personal: parsed.data.score },
			})
			const after = await getTrackingActivityState(tx, userId, mediaId)
			if (!after) throw new Error('Tracking state missing after score update')
			await recordTrackingActivityDiff(tx, {
				actorId: userId,
				mediaId,
				before,
				after,
			})
			return json({ ok: true })
		}

		primary ??= await loadPrimary()
		if (!primary) {
			throw new Response('Choose a status before editing tracking data', {
				status: 400,
			})
		}
		if (!progressUnitsForMediaKind(media.kind).includes(parsed.data.unit)) {
			throw new Response('Progress unit does not match this media', {
				status: 400,
			})
		}
		const savedProgress = await tx.trackingProgress.findUnique({
			where: {
				trackingStateId_unit: {
					trackingStateId: state.id,
					unit: parsed.data.unit,
				},
			},
		})
		const total =
			savedProgress?.total ??
			progressTotal(primary, parsed.data.unit) ??
			progressTotal(catalog, parsed.data.unit)
		if (total !== null && parsed.data.current > total) {
			throw new Response('Progress cannot exceed the known total', {
				status: 400,
			})
		}
		const previousCurrent = savedProgress?.current ?? 0
		const before = await getTrackingActivityState(tx, userId, mediaId)
		await tx.trackingProgress.upsert({
			where: {
				trackingStateId_unit: {
					trackingStateId: state.id,
					unit: parsed.data.unit,
				},
			},
			update: { current: parsed.data.current, total },
			create: {
				trackingStateId: state.id,
				unit: parsed.data.unit,
				current: parsed.data.current,
				total,
			},
		})
		const now = Date.now()
		await tx.entry.update({
			where: { id: primary.id },
			data: legacyProgressUpdate(primary, {
				unit: parsed.data.unit,
				current: parsed.data.current,
				previousCurrent,
				total,
				now,
			}) as Prisma.EntryUpdateInput,
			select: { id: true },
		})
		const after = await getTrackingActivityState(tx, userId, mediaId)
		if (!after) throw new Error('Tracking state missing after progress update')
		await recordTrackingActivityDiff(tx, {
			actorId: userId,
			mediaId,
			before,
			after,
		})
		return json({ ok: true })
	})
}

export default function MediaDetailRoute() {
	const data = useLoaderData<typeof loader>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'
	const tracking = data.viewer?.tracking
	const journal = journalTerms(data.media.kind)
	const maxScoreCount = Math.max(
		1,
		...data.community.scoreDistribution.map(bucket => bucket.count),
	)

	return (
		<main className="mx-auto w-full max-w-6xl px-4 py-8 text-foreground">
			<div className="grid gap-8 md:grid-cols-[16rem_minmax(0,1fr)]">
				<aside className="space-y-4">
					<div className="aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-lg">
						{data.media.imageUrl ? (
							<img
								src={data.media.imageUrl}
								alt={`${data.media.title} cover`}
								className="h-full w-full object-cover"
							/>
						) : (
							<div className="flex h-full items-center justify-center text-muted-foreground">
								No cover
							</div>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						{data.media.externalLinks.map(link => (
							<Button
								asChild
								variant="outline"
								size="sm"
								key={`${link.provider}-${link.externalId}`}
							>
								<a href={link.url ?? '#'} target="_blank" rel="noreferrer">
									{link.provider.toUpperCase()}
								</a>
							</Button>
						))}
					</div>
					<MediaFacts facts={data.media.facts} />
				</aside>

				<div className="space-y-8">
					<header className="space-y-2">
						<div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							{data.media.kind}
							{/* MAL reports a media type that is often just the kind again,
							    so One Piece read "manga · Manga". Only add it when it says
							    something the kind does not. */}
							{data.media.type &&
							data.media.type.trim().toLowerCase() !==
								data.media.kind.trim().toLowerCase()
								? ` · ${data.media.type}`
								: ''}
						</div>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<h1 className="text-4xl font-bold">{data.media.title}</h1>
							{data.viewer ? (
								<Form method="post">
									<input type="hidden" name="intent" value="favorite-toggle" />
									<Button
										type="submit"
										variant={data.viewer.isFavorite ? 'default' : 'outline'}
										disabled={busy}
										aria-pressed={data.viewer.isFavorite}
									>
										{data.viewer.isFavorite
											? '★ Favorited'
											: '☆ Add to favorites'}
									</Button>
								</Form>
							) : (
								<Button asChild variant="outline">
									<Link to={`/login?redirectTo=/media/${data.media.id}`}>
										☆ Add to favorites
									</Link>
								</Button>
							)}
						</div>
						<div className="text-sm text-muted-foreground">
							{displayDate(data.media.releaseStart)} –{' '}
							{displayDate(data.media.releaseEnd)}
						</div>
					</header>

					<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">
								{data.community.trackers}
							</div>
							<div className="text-sm text-muted-foreground">
								Members tracking
							</div>
						</div>
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">
								{data.community.meanScore?.toFixed(2) ?? '—'}
							</div>
							<div className="text-sm text-muted-foreground">
								Community score
							</div>
						</div>
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">{data.community.ratings}</div>
							<div className="text-sm text-muted-foreground">Ratings</div>
						</div>
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">{data.community.reviews}</div>
							<div className="text-sm text-muted-foreground">Reviews</div>
						</div>
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">
								{data.community.diaryEntries}
							</div>
							<div className="text-sm text-muted-foreground">Diary logs</div>
						</div>
						<div
							className="rounded-xl border bg-card p-4"
							aria-label={`${data.community.favorites} community ${data.community.favorites === 1 ? 'favorite' : 'favorites'}`}
						>
							<div className="text-2xl font-bold">
								{data.community.favorites}
							</div>
							<div className="text-sm text-muted-foreground">Favorites</div>
						</div>
					</section>

					{data.community.trackers ? (
						<section
							aria-labelledby="community-insights-heading"
							className="space-y-4"
						>
							<div>
								<h2
									id="community-insights-heading"
									className="text-2xl font-bold"
								>
									Community insights
								</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									See how members rate and track this title.
								</p>
							</div>
							<div className="grid gap-4 lg:grid-cols-2">
								<div className="rounded-xl border bg-card p-5">
									<h3 className="font-bold">Score distribution</h3>
									<p className="mt-1 text-xs text-muted-foreground">
										Decimal ratings are rounded to the nearest whole score for
										this chart.
									</p>
									{data.community.ratings ? (
										<div className="mt-4 space-y-1.5">
											{data.community.scoreDistribution
												.slice()
												.reverse()
												.map(bucket => (
													<div
														key={bucket.score}
														className="grid grid-cols-[1.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs"
														aria-label={`Score ${bucket.score}: ${bucket.count} ${bucket.count === 1 ? 'rating' : 'ratings'}`}
													>
														<span className="font-semibold">
															{bucket.score}
														</span>
														<span className="h-2 overflow-hidden rounded-full bg-muted">
															<span
																className="block h-full rounded-full bg-primary"
																style={{
																	width: `${(bucket.count / maxScoreCount) * 100}%`,
																}}
															/>
														</span>
														<span className="text-right text-muted-foreground">
															{bucket.count}
														</span>
													</div>
												))}
										</div>
									) : (
										<p className="mt-4 text-sm text-muted-foreground">
											No member ratings yet.
										</p>
									)}
								</div>

								<div className="rounded-xl border bg-card p-5">
									<h3 className="font-bold">Tracking status</h3>
									<p className="mt-1 text-xs text-muted-foreground">
										Current library status across {data.community.trackers}{' '}
										{data.community.trackers === 1 ? 'member' : 'members'}.
									</p>
									<div className="mt-4 space-y-3">
										{data.community.statusBreakdown.map(status => (
											<div
												key={status.status}
												aria-label={`${status.label}: ${status.count} ${status.count === 1 ? 'member' : 'members'}`}
											>
												<div className="flex items-center justify-between gap-3 text-sm">
													<span className="font-semibold">{status.label}</span>
													<span className="text-muted-foreground">
														{status.count} · {Math.round(status.percentage)}%
													</span>
												</div>
												<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
													<div
														className="h-full rounded-full bg-primary"
														style={{ width: `${status.percentage}%` }}
													/>
												</div>
											</div>
										))}
									</div>
								</div>
							</div>
							{data.socialContext?.total ? (
								<div
									aria-labelledby="following-context-heading"
									className="rounded-xl border bg-card p-5"
								>
									<div className="flex flex-wrap items-end justify-between gap-3">
										<div>
											<h3 id="following-context-heading" className="font-bold">
												From people you follow
											</h3>
											<p className="mt-1 text-xs text-muted-foreground">
												{data.socialContext.total}{' '}
												{data.socialContext.total === 1
													? 'person tracks'
													: 'people track'}{' '}
												this title
												{data.socialContext.ratings
													? ` · ${data.socialContext.ratings} ${data.socialContext.ratings === 1 ? 'rating' : 'ratings'}`
													: ''}
												.
											</p>
										</div>
										{data.socialContext.meanScore !== null ? (
											<div className="text-right">
												<div className="text-xl font-bold">
													{data.socialContext.meanScore.toFixed(2)}
												</div>
												<div className="text-xs text-muted-foreground">
													Following average
												</div>
											</div>
										) : null}
									</div>
									<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
										{data.socialContext.items.map(item => (
											<Link
												key={item.id}
												to={`/users/${item.member.username}`}
												className="flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/60"
											>
												<img
													src={getUserImgSrc(item.member.image?.id)}
													alt=""
													className="h-10 w-10 shrink-0 rounded-full border object-cover"
												/>
												<div className="min-w-0 flex-1">
													<div className="truncate text-sm font-semibold">
														{item.member.username}
													</div>
													<div className="truncate text-xs text-muted-foreground">
														{item.statusLabel}
														{item.score !== null
															? ` · ${item.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}/10`
															: ''}
													</div>
												</div>
											</Link>
										))}
									</div>
									{data.socialContext.total >
									data.socialContext.items.length ? (
										<p className="mt-3 text-xs text-muted-foreground">
											Showing the {data.socialContext.items.length} most
											recently updated members.
										</p>
									) : null}
								</div>
							) : null}
						</section>
					) : null}

					{data.media.watchAvailability.length ? (
						<section className="space-y-3 rounded-xl border bg-card p-5">
							<h2 className="text-xl font-bold">Where to watch</h2>
							<ul className="flex flex-wrap gap-2">
								{data.media.watchAvailability.map(offer => (
									<li key={`${offer.offerKind}:${offer.providerName}`}>
										{/* TMDB supplies this from JustWatch and requires their
										    link be the destination, so it is the only one used. */}
										<a
											href={offer.link}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold hover:bg-muted"
										>
											{offer.providerName}
											<span className="text-xs font-normal text-muted-foreground">
												{OFFER_KIND_LABELS[offer.offerKind] ?? offer.offerKind}
											</span>
										</a>
									</li>
								))}
							</ul>
							<p className="text-xs text-muted-foreground">
								Streaming availability from JustWatch via TMDB. Regional and
								subject to change.
							</p>
						</section>
					) : null}

					{data.viewer ? (
						<section className="space-y-5 rounded-xl border bg-card p-5">
							<h2 className="text-xl font-bold">Your tracking</h2>
							<div className="space-y-3 rounded-lg border bg-background p-4">
								<div>
									<h3 className="font-bold">Release reminder</h3>
									<p className="mt-1 text-sm text-muted-foreground">
										{data.media.upcomingRelease
											? `${data.media.upcomingRelease.label} · ${displayDateTime(data.media.upcomingRelease.releaseAt)}`
											: 'We’ll notify you when Veud receives a future release date.'}
									</p>
								</div>
								<div className="flex flex-wrap items-end gap-2">
									<Form
										method="post"
										className="flex flex-wrap items-end gap-2"
									>
										<input
											type="hidden"
											name="intent"
											value="release-reminder-save"
										/>
										<div className="space-y-2">
											<Label htmlFor="release-reminder-lead">Notify me</Label>
											<select
												id="release-reminder-lead"
												name="leadMinutes"
												defaultValue={data.viewer.reminder?.leadMinutes ?? 60}
												className="h-10 rounded-md border bg-background px-3 text-sm"
											>
												<option value="0">At release time</option>
												<option value="60">1 hour before</option>
												<option value="1440">1 day before</option>
											</select>
										</div>
										<Button type="submit" variant="outline" disabled={busy}>
											{data.viewer.reminder
												? 'Update reminder'
												: 'Set reminder'}
										</Button>
									</Form>
									{data.viewer.reminder ? (
										<Form method="post">
											<input
												type="hidden"
												name="intent"
												value="release-reminder-delete"
											/>
											<Button type="submit" variant="ghost" disabled={busy}>
												Remove reminder
											</Button>
										</Form>
									) : null}
								</div>
							</div>
							{data.viewer.watchlists.length ? (
								<Form method="post" className="flex flex-wrap items-end gap-3">
									<input type="hidden" name="intent" value="status" />
									<div className="min-w-52 flex-1 space-y-2">
										<Label htmlFor="tracking-status">Status</Label>
										<select
											id="tracking-status"
											name="watchlistId"
											defaultValue={
												tracking?.statusWatchlistId ??
												data.viewer.watchlists[0]?.id
											}
											className="h-10 w-full rounded-md border bg-background px-3 text-sm"
										>
											{data.viewer.watchlists.map(watchlist => (
												<option value={watchlist.id} key={watchlist.id}>
													{watchlist.header}
												</option>
											))}
										</select>
									</div>
									<Button type="submit" disabled={busy}>
										Save status
									</Button>
								</Form>
							) : (
								<p className="text-sm text-muted-foreground">
									Create a compatible watchlist before tracking this title.
								</p>
							)}

							<div className="grid gap-4 sm:grid-cols-2">
								<Form method="post" className="space-y-2">
									<input type="hidden" name="intent" value="score" />
									<Label htmlFor="tracking-score">Score</Label>
									<div className="flex gap-2">
										<Input
											id="tracking-score"
											name="score"
											type="number"
											min="0"
											max="10"
											step="0.1"
											defaultValue={tracking?.score ?? 0}
											disabled={!tracking || busy}
										/>
										<Button
											type="submit"
											variant="outline"
											disabled={!tracking || busy}
										>
											Save
										</Button>
									</div>
								</Form>
								{data.viewer.progress.map(progress => (
									<Form method="post" className="space-y-2" key={progress.unit}>
										<input type="hidden" name="intent" value="progress" />
										<input type="hidden" name="unit" value={progress.unit} />
										<Label htmlFor={`progress-${progress.unit}`}>
											{progressLabel(progress.unit)}
										</Label>
										<div className="flex items-center gap-2">
											<Input
												id={`progress-${progress.unit}`}
												name="current"
												type="number"
												min="0"
												max={progress.total ?? undefined}
												defaultValue={progress.current}
												disabled={!tracking || busy}
											/>
											{progress.total ? (
												<span className="text-sm text-muted-foreground">
													/ {progress.total}
												</span>
											) : null}
											<Button
												type="submit"
												variant="outline"
												disabled={!tracking || busy}
											>
												Save
											</Button>
										</div>
									</Form>
								))}
							</div>
							{tracking ? (
								<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
									<span>Started {displayDate(tracking.startedAt)}</span>
									<span>Completed {displayDate(tracking.completedAt)}</span>
									{tracking.repeatCount > 0 ? (
										<span>{tracking.repeatCount} repeats</span>
									) : null}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									Choose a status to add this title to your library.
								</p>
							)}
						</section>
					) : (
						<section className="rounded-xl border bg-card p-5">
							<p className="text-muted-foreground">
								<Link
									to={`/login?redirectTo=/media/${data.media.id}`}
									className="font-semibold underline"
								>
									Log in
								</Link>{' '}
								to track, favorite, review, and log this title.
							</p>
						</section>
					)}

					{data.viewer ? (
						<section className="space-y-4 rounded-xl border bg-card p-5">
							<div>
								<h2 className="text-xl font-bold">Save to a collection</h2>
								<p className="text-sm text-muted-foreground">
									Add this title to one of your curated lists.
								</p>
							</div>
							{data.viewer.collections.length ? (
								<div className="space-y-3">
									<Form
										method="post"
										className="flex flex-wrap items-end gap-3"
									>
										<input type="hidden" name="intent" value="collection-add" />
										<div className="min-w-52 flex-1 space-y-2">
											<Label htmlFor="collection-id">Collection</Label>
											<select
												id="collection-id"
												name="collectionId"
												className="h-10 w-full rounded-md border bg-background px-3 text-sm"
											>
												{data.viewer.collections.map(collection => (
													<option key={collection.id} value={collection.id}>
														{collection.containsMedia ? '✓ ' : ''}
														{collection.title}
													</option>
												))}
											</select>
										</div>
										<Button type="submit" variant="outline" disabled={busy}>
											Add to collection
										</Button>
									</Form>
									{data.viewer.collectionsTruncated ? (
										<p className="text-sm text-muted-foreground">
											Showing your most recent collections.{' '}
											<Link
												to="/collections"
												className="font-semibold underline"
											>
												View all
											</Link>
										</p>
									) : null}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									<Link
										to="/collections/new"
										className="font-semibold underline"
									>
										Create your first collection
									</Link>{' '}
									to save this title.
								</p>
							)}
						</section>
					) : null}

					{data.viewer ? (
						<section className="grid gap-5 lg:grid-cols-2">
							<div className="space-y-4 rounded-xl border bg-card p-5">
								<div>
									<h2 className="text-xl font-bold">Your diary</h2>
									<p className="text-sm text-muted-foreground">
										Log each {journal.action}, including repeats.
									</p>
								</div>
								<Form method="post" className="grid gap-3 sm:grid-cols-2">
									<input type="hidden" name="intent" value="diary-create" />
									<div className="space-y-2">
										<Label htmlFor="diary-date">Date</Label>
										<Input
											id="diary-date"
											name="loggedOn"
											type="date"
											defaultValue={todayDateInput()}
											required
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="diary-rating">Diary rating</Label>
										<Input
											id="diary-rating"
											name="rating"
											type="number"
											min="0.1"
											max="10"
											step="0.1"
											defaultValue={tracking?.score ?? ''}
											placeholder="Optional"
										/>
									</div>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" name="isRepeat" value="true" />
										{journal.repeat}
									</label>
									<Button type="submit" disabled={busy}>
										Log {journal.action}
									</Button>
								</Form>

								{data.viewer.diaryEntries.length ? (
									<ul className="divide-y rounded-lg border">
										{data.viewer.diaryEntries.map(entry => (
											<li
												key={entry.id}
												className="flex items-center justify-between gap-3 p-3"
											>
												<div className="text-sm">
													<span className="font-semibold">
														{entry.isRepeat ? journal.repeat : journal.past}
													</span>{' '}
													{displayDiaryDate(entry.loggedOn)}
													{entry.rating !== null ? ` · ${entry.rating}/10` : ''}
												</div>
												<Form method="post">
													<input
														type="hidden"
														name="intent"
														value="diary-delete"
													/>
													<input
														type="hidden"
														name="diaryEntryId"
														value={entry.id}
													/>
													<Button
														type="submit"
														variant="ghost"
														size="sm"
														disabled={busy}
													>
														Delete
													</Button>
												</Form>
											</li>
										))}
									</ul>
								) : (
									<p className="text-sm text-muted-foreground">
										No diary entries yet.
									</p>
								)}
							</div>

							<div className="space-y-4 rounded-xl border bg-card p-5">
								<div>
									<h2 className="text-xl font-bold">Your review</h2>
									<p className="text-sm text-muted-foreground">
										Share a spoiler-safe review with the community.
									</p>
								</div>
								<ReviewEditor
									key={
										data.viewer.review?.updatedAt?.toString() ?? 'new-review'
									}
									initialBody={data.viewer.review?.body ?? ''}
									initialRating={
										data.viewer.review?.rating ?? tracking?.score ?? null
									}
									initialContainsSpoilers={
										data.viewer.review?.containsSpoilers ?? false
									}
									maxLength={REVIEW_MAX_LENGTH}
									isExisting={Boolean(data.viewer.review)}
								/>
								{data.viewer.review ? (
									<Form method="post">
										<input type="hidden" name="intent" value="review-delete" />
										<Button type="submit" variant="destructive" disabled={busy}>
											Delete review
										</Button>
									</Form>
								) : null}
							</div>
						</section>
					) : null}

					<section className="space-y-3">
						<h2 className="text-2xl font-bold">Overview</h2>
						<p className="whitespace-pre-line leading-7 text-muted-foreground">
							{data.media.description || 'No description is available yet.'}
						</p>
						{data.media.genres ? (
							<p className="text-sm text-muted-foreground">
								<strong className="text-foreground">Genres:</strong>{' '}
								{data.media.genres}
							</p>
						) : null}
						{/* Whose is this? Directly under the description, as TMDB does
						    it — the crew list proper has its own page. */}
						<KeyCrew crew={data.credits.keyCrew} />
					</section>

					<TopBilledCast
						cast={data.credits.cast}
						total={data.credits.castTotal}
						mediaId={data.media.id}
					/>

					<MediaVideos videos={data.media.videos} />

					{data.relations.length ? (
						<section
							className="space-y-4"
							aria-labelledby="related-titles-heading"
						>
							<header>
								<h2 id="related-titles-heading" className="text-2xl font-bold">
									Related titles
								</h2>
								<p className="text-sm text-muted-foreground">
									Canonical franchise and story connections.
								</p>
							</header>
							<div className="space-y-5">
								{data.relations.map(group => (
									<div key={group.relationType} className="space-y-2">
										<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
											{group.label}
										</h3>
										<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
											{group.items.map(item => (
												<Link
													key={item.id}
													to={`/media/${item.id}`}
													className="group flex min-w-0 gap-3 rounded-xl border bg-card p-3 transition hover:border-primary/60 hover:bg-muted/50"
												>
													<div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
														{item.imageUrl ? (
															<img
																src={item.imageUrl}
																alt=""
																loading="lazy"
																className="h-full w-full object-cover"
															/>
														) : (
															<div className="flex h-full items-center justify-center px-2 text-center text-[0.65rem] text-muted-foreground">
																No poster
															</div>
														)}
													</div>
													<div className="min-w-0 flex-1 py-0.5">
														<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
															{item.type || item.kind}
															{item.year ? ` · ${item.year}` : ''}
														</div>
														<h4 className="mt-1 line-clamp-3 font-bold leading-5 group-hover:underline">
															{item.title}
														</h4>
														<div className="mt-2 space-y-1 text-xs">
															{item.viewerTracking ? (
																<span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
																	{item.viewerTracking.statusLabel}
																	{item.viewerTracking.score !== null
																		? ` · ${item.viewerTracking.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}/10`
																		: ''}
																</span>
															) : null}
															<div className="text-muted-foreground">
																{item.trackerCount}{' '}
																{item.trackerCount === 1 ? 'member' : 'members'}{' '}
																tracking
															</div>
														</div>
													</div>
												</Link>
											))}
										</div>
									</div>
								))}
							</div>
						</section>
					) : null}

					{data.recommendations.items.length ? (
						<section
							aria-labelledby="similar-media-heading"
							className="space-y-4"
						>
							<header className="flex flex-wrap items-end justify-between gap-3">
								<div>
									<h2 id="similar-media-heading" className="text-2xl font-bold">
										More like this
									</h2>
									<p className="mt-1 text-sm text-muted-foreground">
										{data.recommendations.sourceGenres.length
											? 'Ranked by shared genres, then community activity.'
											: `Popular ${data.media.kind} titles from the community.`}
									</p>
								</div>
								<Button asChild variant="outline" size="sm">
									<Link
										to={recommendationDiscoveryHref(
											data.media.kind,
											data.recommendations.sourceGenres[0],
										)}
									>
										Explore more
									</Link>
								</Button>
							</header>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{data.recommendations.items.map(item => {
									const poster = splitLegacyThumbnail(item.thumbnail).imageUrl
									return (
										<Link
											key={item.id}
											to={`/media/${item.id}`}
											className="group flex min-w-0 gap-3 rounded-xl border bg-card p-3 transition hover:border-primary/60 hover:bg-muted/50"
										>
											<div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
												{poster ? (
													<img
														src={poster}
														alt=""
														loading="lazy"
														className="h-full w-full object-cover"
													/>
												) : (
													<div className="flex h-full items-center justify-center px-2 text-center text-[0.65rem] text-muted-foreground">
														No poster
													</div>
												)}
											</div>
											<div className="min-w-0 flex-1 py-0.5">
												<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
													{item.type || item.kind}
													{item.year ? ` · ${item.year}` : ''}
												</div>
												<h3 className="mt-1 line-clamp-2 font-bold leading-5 group-hover:underline">
													{item.title}
												</h3>
												{item.matchedGenres.length ? (
													<div className="mt-2 flex flex-wrap gap-1">
														{item.matchedGenres.slice(0, 2).map(genre => (
															<span
																key={genre}
																className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold text-primary"
															>
																{genre}
															</span>
														))}
													</div>
												) : null}
												<div className="mt-2 text-xs text-muted-foreground">
													{item.communityScore !== null
														? `★ ${item.communityScore.toFixed(1)} (${item.ratingCount}) · `
														: 'Not yet rated · '}
													{item.trackerCount} tracking
												</div>
											</div>
										</Link>
									)
								})}
							</div>
						</section>
					) : null}

					<section className="space-y-3">
						<div className="flex items-end justify-between gap-3">
							<h2 className="text-2xl font-bold">Community reviews</h2>
							<span className="text-sm text-muted-foreground">
								{data.community.reviews}{' '}
								{data.community.reviews === 1 ? 'review' : 'reviews'}
							</span>
						</div>
						{data.reviews.length ? (
							<div className="space-y-3">
								{data.reviews.map(review => (
									<article
										key={review.id}
										id={`review-${review.id}`}
										className="space-y-3 rounded-xl border bg-card p-5"
									>
										<header className="flex flex-wrap items-center justify-between gap-2">
											<div>
												<Link
													to={`/users/${review.author.username}`}
													className="font-semibold hover:underline"
												>
													{review.author.username}
												</Link>
												{review.rating !== null ? (
													<span className="ml-2 text-sm font-semibold">
														{review.rating}/10
													</span>
												) : null}
											</div>
											<div className="flex items-center gap-2">
												{data.viewer && data.viewer.id !== review.author.id ? (
													<ReportContentButton
														targetType="review"
														targetId={review.id}
														label="review"
													/>
												) : null}
												<time className="text-sm text-muted-foreground">
													{displayDate(review.createdAt)}
												</time>
											</div>
										</header>
										{review.containsSpoilers ? (
											<details className="rounded-lg border bg-background p-3">
												<summary className="cursor-pointer font-semibold">
													Contains spoilers — reveal review
												</summary>
												{/* Inside the gate: expanding a spoiler-flagged review must
												    not print the rest of it in the clear. */}
												<div className="mt-3">
													<ReviewBody
														reviewId={review.id}
														excerpt={review.body}
														truncated={review.bodyTruncated}
													/>
												</div>
											</details>
										) : (
											<ReviewBody
												reviewId={review.id}
												excerpt={review.body}
												truncated={review.bodyTruncated}
											/>
										)}
										<div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
											{data.viewer ? (
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
														disabled={busy}
													>
														{review.viewerLiked ? 'Unlike' : 'Like'} ·{' '}
														{review._count.likes}
													</Button>
												</Form>
											) : (
												<Button asChild variant="outline" size="sm">
													<Link to="/login">Like · {review._count.likes}</Link>
												</Button>
											)}
											<span className="text-muted-foreground">
												{review._count.comments}{' '}
												{review._count.comments === 1 ? 'comment' : 'comments'}
											</span>
										</div>
										{review.containsSpoilers ? (
											<details className="rounded-lg border p-3">
												<summary className="cursor-pointer text-sm font-semibold">
													Discussion may contain spoilers
												</summary>
												<div className="mt-3">
													<ReviewDiscussion
														// See the note on the other branch: a fetched
														// remainder goes stale the moment a comment is added.
														key={review._count.comments}
														reviewId={review.id}
														reviewAuthorId={review.author.id}
														comments={review.comments}
														commentCount={review._count.comments}
														viewerId={data.viewer?.id ?? null}
														busy={busy}
													/>
												</div>
											</details>
										) : (
											<ReviewDiscussion
												// Posting or deleting a comment makes any remainder already
												// fetched stale — most visibly the member's own new comment,
												// which is the newest and so lands outside what was loaded.
												// Remounting drops it and re-offers the control.
												key={review._count.comments}
												reviewId={review.id}
												reviewAuthorId={review.author.id}
												comments={review.comments}
												commentCount={review._count.comments}
												viewerId={data.viewer?.id ?? null}
												busy={busy}
											/>
										)}
									</article>
								))}
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								No reviews yet. Be the first to share one.
							</p>
						)}
					</section>

					<section className="space-y-3">
						<h2 className="text-2xl font-bold">Recent activity</h2>
						{data.activity.length ? (
							<ul className="divide-y rounded-xl border bg-card">
								{data.activity.map(event => (
									<li
										key={event.id}
										className="flex flex-wrap items-center justify-between gap-2 p-4"
									>
										<div>
											<Link
												to={`/users/${event.actor.username}`}
												className="font-semibold hover:underline"
											>
												{event.actor.username}
											</Link>{' '}
											<span className="text-muted-foreground">
												{event.action.toLowerCase()}
											</span>
										</div>
										<time className="text-sm text-muted-foreground">
											{displayDateTime(event.createdAt)}
										</time>
									</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-muted-foreground">
								No tracking activity yet.
							</p>
						)}
					</section>
				</div>
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, matches }) => {
	if (!loaderData) {
		return [
			{ title: 'Media | Veud' },
			{
				name: 'description',
				content: 'Media details and community tracking on Veud',
			},
		]
	}

	const { media, community } = loaderData
	const origin = originFromMatches(matches)
	const title = `${media.title} | ${SITE_NAME}`
	const description = socialDescription(
		media.description,
		`${media.title} on ${SITE_NAME} — tracking, ratings, and reviews from the community.`,
	)
	const url = absoluteUrl(origin, `/media/${media.id}`)
	const image = absoluteUrl(origin, media.imageUrl)

	return [
		...socialMeta({
			title,
			description,
			url,
			image,
			imageAlt: image ? `Cover art for ${media.title}` : undefined,
			type: openGraphType(media.kind, media.type),
		}),
		structuredData(
			withoutEmptyValues({
				'@type': schemaTypeForKind(media.kind, media.type),
				name: media.title,
				url,
				image,
				description,
				genre: splitGenres(media.genres),
				datePublished: isoDate(media.releaseStart),
				// Only claimed when members have actually rated it. An
				// `aggregateRating` with no ratings behind it is the kind of thing
				// search engines penalise, and rightly.
				aggregateRating:
					community.meanScore !== null && community.ratings > 0
						? {
								'@type': 'AggregateRating',
								ratingValue: Number(community.meanScore.toFixed(2)),
								ratingCount: community.ratings,
								bestRating: 10,
								worstRating: 1,
							}
						: null,
			}),
		),
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => <p>That media title could not be found.</p>,
			}}
		/>
	)
}
