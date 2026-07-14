import { prisma } from '#app/utils/db.server.ts'
import { resolveEntryModel } from '#app/utils/lists/authorization.server.ts'

// Watchlists are public (profile pages render them without a login), so reading a
// list's entries needs no authentication — it returns only already-public data.
export async function loader({ params }) {
  const searchParams = new URLSearchParams(params.request)

  const watchlistId = searchParams.get('watchlistId')?.toLowerCase()
  const watchlist = watchlistId
    ? await prisma.watchlist.findUnique({ where: { id: watchlistId } })
    : null

  if (!watchlist) return []

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))

  return await prisma[typeFormatted].findMany({
    where: {
      watchlistId: watchlist.id,
    },
  })
}
