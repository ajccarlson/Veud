import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    const listID = await prisma.watchlist.findFirst({
      where: {
        id: searchParams.get('watchlistId').toLowerCase(),
      },
    })

    const typeFormatted = JSON.parse(searchParams.get('listTypeData')).header.replace(/\W/g, '') + "Entry"
  
    const entries = await prisma[typeFormatted].findMany({
      where: {
        watchlistId: listID.id,
      },
    })

    let removedEntries = [];

    for (const entry of entries) {
      if ((!entry.title || entry.title.replace(/\W/g, '') === "") && (!entry.type || entry.type.replace(/\W/g, '') === "")) {
        removedEntries.push(entry)

        await prisma[typeFormatted].delete({
          where: {
            id: entry.id,
          },
        });
      }
    }

    return removedEntries
  }
  catch(e) {
    return e
  }
};
