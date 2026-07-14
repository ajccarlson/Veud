import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const listId = searchParams.get('listId')

  // Only the owner may change this watchlist's settings.
  const { userId } = await requireWatchlistOwner(request, listId)

  const settings = JSON.parse(searchParams.get('settings'))
  const typeId = JSON.parse(searchParams.get('listTypeData')).id

  // Apply the settings and renumber the owner's watchlists of this type atomically, so a
  // failure can't leave settings half-applied or the ordering inconsistent.
  const response = await prisma.$transaction(async (tx) => {
    const updated = []
    for (const setting of settings) {
      updated.push(
        await tx.watchlist.update({
          where: { id: listId },
          data: { [setting[0]]: setting[1] },
        }),
      )
    }

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

    return updated
  })

  return response
}
