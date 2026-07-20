import { type Prisma } from '@prisma/client'

type ToggleReviewLikeInput = {
	userId: string
	reviewId: string
	mediaId?: string
}

export async function toggleReviewLike(
	tx: Prisma.TransactionClient,
	input: ToggleReviewLikeInput,
) {
	const review = await tx.review.findFirst({
		where: {
			id: input.reviewId,
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
