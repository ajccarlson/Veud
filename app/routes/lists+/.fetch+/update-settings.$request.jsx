import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!searchParams.get('authorization') || searchParams.get('authorization') != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    let response = []

    for (const setting of JSON.parse(searchParams.get('settings'))) {
      response.push(await prisma.watchlist.update({
        where: {
          id: searchParams.get('listId'),
        },
        data: {
          [setting[0]]: setting[1],
        },
      }));
    }

    const watchLists = await prisma.watchlist.findMany({
      where: {
        typeId: JSON.parse(searchParams.get('listTypeData')).id,
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
    
    return response
  }
  catch(e) {
    return e
  }
};
