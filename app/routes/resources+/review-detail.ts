import { data as json, type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { REVIEW_COMMENT_PREVIEW } from '#app/utils/review-excerpt.ts'

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
 * Only visible reviews and visible comments are served, exactly as the page
 * itself selects them — an endpoint that returned moderated-away content to
 * anyone who guessed an id would undo the moderation.
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
				where: { moderationStatus: 'visible' },
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				// The page already showed the first few; this is the remainder, and
				// it is still bounded — a review with ten thousand comments is not a
				// reason to send ten thousand comments.
				skip: REVIEW_COMMENT_PREVIEW,
				take: 200,
				select: {
					id: true,
					body: true,
					parentId: true,
					createdAt: true,
					author: { select: { id: true, username: true } },
				},
			},
		},
	})
	if (!review) return json({ ok: false as const }, { status: 404 })

	return json(
		{ ok: true as const, review },
		{
			headers: {
				// Public content, but it can be edited or moderated at any moment, so
				// this is short enough that a withdrawn review does not linger.
				'Cache-Control': 'public, max-age=30',
			},
		},
	)
}
