import { prisma } from '#app/utils/db.server.ts'
import {
  requireWatchlistOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const id = searchParams.get('id')

  // Only the owner may delete this watchlist.
  const { userId } = await requireWatchlistOwner(request, id)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))
  const typeId = JSON.parse(searchParams.get('listTypeData')).id

  // Delete the watchlist, remove its entries, and renumber the owner's remaining
  // watchlists of this type — all atomically, so a mid-sequence failure can't leave a
  // half-deleted list or gaps in the ordering.
  await prisma.$transaction(async (tx) => {
    await tx.watchlist.delete({ where: { id } })

    await tx[typeFormatted].deleteMany({ where: { watchlistId: id } })

    const remaining = await tx.watchlist.findMany({
      where: { typeId, ownerId: userId },
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
