import { type ActionFunctionArgs } from '@remix-run/node'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { stripProtectedFields } from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  const searchParams = new URLSearchParams(params.request)

  let favorite: unknown
  try {
    favorite = JSON.parse(searchParams.get('favorite') ?? '')
  } catch {
    throw new Response('Invalid favorite payload', { status: 400 })
  }
  if (!favorite || typeof favorite !== 'object' || Array.isArray(favorite)) {
    throw new Response('Invalid favorite payload', { status: 400 })
  }

  // The client must not choose the id, and ownership always comes from the session.
  const data = {
    ...stripProtectedFields(favorite as Record<string, unknown>, ['id']),
    ownerId: userId,
  }

  // `data` is a runtime-validated object; Prisma's create input can't be inferred from
  // arbitrary client JSON, so the shape is asserted here.
  return await prisma.userFavorite.create({ data: data as any })
}
