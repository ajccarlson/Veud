import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    const listID = await prisma.watchlist.findFirst({
      where: {
        name: searchParams.get('listName').toLowerCase(),
      },
    })

    const typeFormatted = JSON.parse(searchParams.get('listTypeData')).header.replace(/\W/g, '') + "Entry"
  
    const entries = await prisma[typeFormatted].findMany({
      where: {
        watchlistId: listID.id,
      },
    })
  
    return entries;
  }
  catch(e) {
    return e
  }
}