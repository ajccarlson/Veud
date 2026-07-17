import { type ActionFunctionArgs } from '@remix-run/node'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  const searchParams = new URLSearchParams(params.request)

  let order: unknown
  try {
    order = JSON.parse(searchParams.get('order') ?? '')
  } catch {
    throw new Response('Invalid order payload', { status: 400 })
  }
  if (!Array.isArray(order)) {
    throw new Response('Invalid order payload', { status: 400 })
  }

  // Validate shape: an array of { id: string, position: number }.
  const updates: { id: string; position: number }[] = []
  for (const item of order) {
    if (!item || typeof item !== 'object') {
      throw new Response('Invalid order payload', { status: 400 })
    }
    const { id, position } = item as Record<string, unknown>
    if (typeof id !== 'string' || typeof position !== 'number') {
      throw new Response('Invalid order payload', { status: 400 })
    }
    updates.push({ id, position })
  }

  // Every favorite being reordered must belong to the session user.
  const ids = updates.map(update => update.id)
  const owned = await prisma.userFavorite.findMany({
    where: { id: { in: ids }, ownerId: userId },
    select: { id: true },
  })
  if (owned.length !== ids.length) {
    throw new Response('Not found', { status: 404 })
  }

  await prisma.$transaction(
    updates.map(update =>
      prisma.userFavorite.update({
        where: { id: update.id },
        data: { position: update.position },
      }),
    ),
  )

  return { ok: true }
}
