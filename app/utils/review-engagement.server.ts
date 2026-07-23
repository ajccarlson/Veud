import { type Prisma } from '@prisma/client'

type ToggleReviewLikeInput = {
	userId: string
	reviewId: string
	mediaId?: string
}

type CreateReviewCommentInput = {
	userId: string
	reviewId: string
	body: string
	parentId?: string | null
	mediaId?: string
}

export async function createReviewComment(
	tx: Prisma.TransactionClient,
	input: CreateReviewCommentInput,
) {
	const review = await tx.review.findFirst({
		where: {
			id: input.reviewId,
			moderationStatus: 'visible',
			...(input.mediaId ? { mediaId: input.mediaId } : {}),
		},
		select: { id: true, authorId: true },
	})
	if (!review) throw new Response('Review not found', { status: 404 })

	const parent = input.parentId
		? await tx.reviewComment.findFirst({
				where: {
					id: input.parentId,
					reviewId: review.id,
					moderationStatus: 'visible',
				},
				select: { id: true, authorId: true },
			})
		: null
	if (input.parentId && !parent) {
		throw new Response('Parent comment not found', { status: 400 })
	}

	const comment = await tx.reviewComment.create({
		data: {
			authorId: input.userId,
			reviewId: review.id,
			parentId: parent?.id,
			body: input.body,
		},
		select: { id: true },
	})
	const recipientId = parent?.authorId ?? review.authorId
	if (recipientId !== input.userId) {
		await tx.notification.create({
			data: {
				type: parent ? 'review_reply' : 'review_comment',
				recipientId,
				actorId: input.userId,
				reviewId: review.id,
				reviewCommentId: comment.id,
			},
		})
	}

	return { commentId: comment.id }
}

export async function toggleReviewLike(
	tx: Prisma.TransactionClient,
	input: ToggleReviewLikeInput,
) {
	const review = await tx.review.findFirst({
		where: {
			id: input.reviewId,
			moderationStatus: 'visible',
			...(input.mediaId ? { mediaId: input.mediaId } : {}),
		},
		select: { id: true, authorId: true },
	})
	if (!review) throw new Response('Review not found', { status: 404 })

	const existing = await tx.reviewLike.findUnique({
		where: {
			userId_reviewId: { userId: input.userId, reviewId: review.id },
		},
		select: { id: true },
	})
	if (existing) {
		await tx.reviewLike.delete({ where: { id: existing.id } })
		return { liked: false }
	}

	const like = await tx.reviewLike.create({
		data: { userId: input.userId, reviewId: review.id },
		select: { id: true },
	})
	if (review.authorId !== input.userId) {
		await tx.notification.create({
			data: {
				type: 'review_like',
				recipientId: review.authorId,
				actorId: input.userId,
				reviewId: review.id,
				reviewLikeId: like.id,
			},
		})
	}

	return { liked: true }
}
