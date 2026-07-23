import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

const FollowActionSchema = z.object({
	userId: z.string().trim().min(1).max(100),
	intent: z.enum(['follow', 'unfollow']),
})

const MAX_FOLLOW_REQUEST_SIZE = 1_000

async function parseFollowRequest(request: Request) {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new Response('Follow requests require application/json', {
			status: 415,
		})
	}

	const declaredLength = Number(request.headers.get('content-length') ?? 0)
	if (declaredLength > MAX_FOLLOW_REQUEST_SIZE) {
		throw new Response('Follow request is too large', { status: 413 })
	}

	const rawBody = await request.text()
	if (rawBody.length > MAX_FOLLOW_REQUEST_SIZE) {
		throw new Response('Follow request is too large', { status: 413 })
	}

	try {
		return JSON.parse(rawBody) as unknown
	} catch {
		throw new Response('Invalid follow request', { status: 400 })
	}
}

export async function action({ request, url }: ActionFunctionArgs) {
	const followerId = await requireUserId(request, { url })
	const parsed = FollowActionSchema.safeParse(await parseFollowRequest(request))
	if (!parsed.success) {
		throw new Response('Invalid follow request', { status: 400 })
	}
	const { userId: followingId, intent } = parsed.data

	if (followingId === followerId) {
		throw new Response('Cannot follow yourself', { status: 400 })
	}

	if (intent === 'unfollow') {
		// deleteMany is a no-op if the follow doesn't exist, so this is idempotent.
		await prisma.follow.deleteMany({ where: { followerId, followingId } })
	} else {
		const following = await prisma.user.findUnique({
			where: { id: followingId },
			select: { id: true },
		})
		if (!following) throw new Response('Profile not found', { status: 404 })
		// upsert makes following idempotent (the unique constraint would otherwise
		// throw on a double-follow).
		await prisma.follow.upsert({
			where: { followerId_followingId: { followerId, followingId } },
			create: { followerId, followingId },
			update: {},
		})
	}

	return { ok: true }
}
