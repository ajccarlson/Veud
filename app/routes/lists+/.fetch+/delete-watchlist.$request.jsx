import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    await prisma.watchlist.delete({
      where: {
        id: searchParams.get('id'),
      },
    });

    await prisma[searchParams.get('listType')].delete({
      where: {
        watchlistId: searchParams.get('id'),
      },
    })

    const watchLists = await prisma.watchlist.findMany({
      where: {
        type: searchParams.get('listType'),
        ownerId: searchParams.get('ownerId'),
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
  catch(e) {
    return e
  }
};
