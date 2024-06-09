import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!searchParams.get('authorization') || searchParams.get('authorization') != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    const listID = await prisma.watchlist.findUnique({
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
  
    return entries;
  }
  catch(e) {
    return e
  }
}