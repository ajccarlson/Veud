import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const listId = searchParams.get('listId')

  // Only the owner may change this watchlist's settings.
  const { userId } = await requireWatchlistOwner(request, listId)

  let response = []

  for (const setting of JSON.parse(searchParams.get('settings'))) {
    response.push(await prisma.watchlist.update({
      where: {
        id: listId,
      },
      data: {
        [setting[0]]: setting[1],
      },
    }));
  }

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

  return response
}
