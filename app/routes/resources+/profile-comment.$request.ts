import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { PROFILE_COMMENT_MAX_LENGTH } from '#app/utils/profile.ts'

const CommentBodySchema = z
	.string()
	.trim()
	.min(1)
	.max(PROFILE_COMMENT_MAX_LENGTH)

export async function action({ request, params, url }: ActionFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const searchParams = new URLSearchParams(params.request)
	const intent = searchParams.get('intent')

	if (intent === 'create') {
		const profileId = searchParams.get('profileId')
		const bodyResult = CommentBodySchema.safeParse(searchParams.get('body'))

		if (!profileId) {
			throw new Response('Missing profileId', { status: 400 })
		}
		if (!bodyResult.success) {
			throw new Response(
				`Comment must be between 1 and ${PROFILE_COMMENT_MAX_LENGTH} characters`,
				{ status: 400 },
			)
		}

		const profile = await prisma.user.findUnique({
			where: { id: profileId },
			select: { id: true },
		})
		if (!profile) {
			throw new Response('Profile not found', { status: 404 })
		}

		const comment = await prisma.profileComment.create({
			data: {
				authorId: userId,
				profileId: profile.id,
				body: bodyResult.data,
			},
			select: { id: true },
		})

		return json({ ok: true, commentId: comment.id })
	}

	if (intent === 'delete') {
		const commentId = searchParams.get('commentId')
		if (!commentId) {
			throw new Response('Missing commentId', { status: 400 })
		}

		const comment = await prisma.profileComment.findUnique({
			where: { id: commentId },
			select: { id: true, authorId: true, profileId: true },
		})

		if (
			!comment ||
			(comment.authorId !== userId && comment.profileId !== userId)
		) {
			throw new Response('Comment not found', { status: 404 })
		}

		await prisma.profileComment.delete({ where: { id: comment.id } })
		return json({ ok: true })
	}

	throw new Response('Invalid intent', { status: 400 })
}
