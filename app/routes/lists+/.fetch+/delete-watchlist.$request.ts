import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const id = searchParams.get('id')

  // Only the owner may delete this watchlist.
  const { userId, watchlist } = await requireWatchlistOwner(request, id)

  let typeId: unknown
  try {
    typeId = (
      JSON.parse(searchParams.get('listTypeData') ?? '') as { id?: unknown }
    )?.id
  } catch {
    throw new Response('Invalid listTypeData', { status: 400 })
  }

  // Delete the watchlist, remove its entries, and renumber the owner's remaining
  // watchlists of this type — all atomically, so a mid-sequence failure can't leave a
  // half-deleted list or gaps in the ordering.
  await prisma.$transaction(async (tx) => {
    await tx.watchlist.delete({ where: { id: watchlist.id } })

    await tx.entry.deleteMany({
      where: { watchlistId: watchlist.id },
    })

    const remaining = await tx.watchlist.findMany({
      where: { typeId: typeId as string, ownerId: userId },
      orderBy: { position: 'asc' },
    })

    for (let i = 0; i < remaining.length; i++) {
      await tx.watchlist.update({
        where: { id: remaining[i].id },
        data: { position: i + 1 },
      })
    }
  })

  return true
}
