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

const ProfileCommentActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('create'),
		profileId: z.string().trim().min(1).max(100),
		body: CommentBodySchema,
	}),
	z.object({
		intent: z.literal('delete'),
		commentId: z.string().trim().min(1).max(100),
	}),
])

const MAX_PROFILE_COMMENT_REQUEST_SIZE = 4_000

async function parseProfileCommentRequest(request: Request) {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new Response('Profile comment requests require application/json', {
			status: 415,
		})
	}

	const declaredLength = Number(request.headers.get('content-length') ?? 0)
	if (declaredLength > MAX_PROFILE_COMMENT_REQUEST_SIZE) {
		throw new Response('Profile comment request is too large', { status: 413 })
	}

	const rawBody = await request.text()
	if (rawBody.length > MAX_PROFILE_COMMENT_REQUEST_SIZE) {
		throw new Response('Profile comment request is too large', { status: 413 })
	}

	try {
		return JSON.parse(rawBody) as unknown
	} catch {
		throw new Response('Invalid profile comment request', { status: 400 })
	}
}

export async function action({ request, url }: ActionFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const result = ProfileCommentActionSchema.safeParse(
		await parseProfileCommentRequest(request),
	)
	if (!result.success) {
		throw new Response('Invalid profile comment request', { status: 400 })
	}

	if (result.data.intent === 'create') {
		const profile = await prisma.user.findUnique({
			where: { id: result.data.profileId },
			select: { id: true },
		})
		if (!profile) {
			throw new Response('Profile not found', { status: 404 })
		}

		const comment = await prisma.profileComment.create({
			data: {
				authorId: userId,
				profileId: profile.id,
				body: result.data.body,
			},
			select: { id: true },
		})

		return json({ ok: true, commentId: comment.id })
	}

	if (result.data.intent === 'delete') {
		const comment = await prisma.profileComment.findUnique({
			where: { id: result.data.commentId },
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

	throw new Response('Invalid profile comment request', { status: 400 })
}
