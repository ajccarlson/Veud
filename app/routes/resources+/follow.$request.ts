import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const followerId = await requireUserId(request)
  const searchParams = new URLSearchParams(params.request)
  const followingId = searchParams.get('userId')
  const intent = searchParams.get('intent')

  if (!followingId) {
    throw new Response('Missing userId', { status: 400 })
  }
  if (followingId === followerId) {
    throw new Response('Cannot follow yourself', { status: 400 })
  }

  if (intent === 'unfollow') {
    // deleteMany is a no-op if the follow doesn't exist, so this is idempotent.
    await prisma.follow.deleteMany({ where: { followerId, followingId } })
  } else {
    // upsert makes following idempotent (the unique constraint would otherwise throw
    // on a double-follow).
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    })
  }

  return { ok: true }
}
