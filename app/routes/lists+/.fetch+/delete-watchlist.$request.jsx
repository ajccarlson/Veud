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

  await prisma.watchlist.delete({
    where: {
      id,
    },
  });

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))

  await prisma[typeFormatted].deleteMany({
    where: {
      watchlistId: id,
    },
  })

  const watchLists = await prisma.watchlist.findMany({
    where: {
      typeId: JSON.parse(searchParams.get('listTypeData')).id,
      ownerId: userId,
    },
  })

  const watchListsSorted = watchLists.sort((a,b) => a.position - b.position)

  for (let i = 0; i < watchListsSorted.length; i++) {
    await prisma.watchlist.update({
      where: {
        id: watchListsSorted[i].id,
      },
      data: {
        position: (i + 1),
      },
    })
  }

  return true
}
