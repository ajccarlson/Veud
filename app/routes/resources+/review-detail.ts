import { data as json, type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	displayComment,
	REVIEW_COMMENT_PREVIEW,
	REVIEW_COMMENT_REMAINDER_LIMIT,
} from '#app/utils/review-excerpt.ts'

/**
 * The rest of a review: its full body, and the comments the media page did not
 * send.
 *
 * The media page lists twenty reviews. Sending every body in full meant up to
 * 5,000 characters each, and nesting fifty comments under each meant up to a
 * thousand comments, on a page most visitors read the top of. It now sends an
 * excerpt and a handful of comments, and anyone who wants the whole thing asks
 * for that one review here.
 *
 * Only visible reviews are served — an endpoint that returned a moderated-away
 * review to anyone who guessed its id would undo the moderation. A removed
 * *comment* is served as the same tombstone the page shows, never as its body,
 * because the page counts one toward the handful it displayed and this has to
 * resume from the same place.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const reviewId = new URL(request.url).searchParams.get('reviewId')?.trim()
	if (!reviewId || reviewId.length > 100) {
		return json({ ok: false as const }, { status: 400 })
	}

	const review = await prisma.review.findFirst({
		where: { id: reviewId, moderationStatus: 'visible' },
		select: {
			id: true,
			body: true,
			comments: {
				// Deliberately unfiltered, and skipping the same unfiltered set the
				// page took. The page renders a removed comment as a tombstone, so it
				// spends one of its `REVIEW_COMMENT_PREVIEW` slots; skipping past only
				// the *visible* ones would step over as many comments as had been
				// removed and drop them from the page entirely. Bodies are still
				// withheld below — this decides position, not visibility.
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				skip: REVIEW_COMMENT_PREVIEW,
				take: REVIEW_COMMENT_REMAINDER_LIMIT,
				select: {
					id: true,
					body: true,
					moderationStatus: true,
					parentId: true,
					createdAt: true,
					author: { select: { id: true, username: true } },
				},
			},
		},
	})
	if (!review) return json({ ok: false as const }, { status: 404 })

	return json(
		{
			ok: true as const,
			review: { ...review, comments: review.comments.map(displayComment) },
		},
		{
			headers: {
				// Public content, but it can be edited or moderated at any moment, so
				// this is short enough that a withdrawn review does not linger.
				'Cache-Control': 'public, max-age=30',
			},
		},
	)
}
