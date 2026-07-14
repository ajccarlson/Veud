import { prisma } from '#app/utils/db.server.ts'
import {
  requireWatchlistOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const { watchlist } = await requireWatchlistOwner(
    request,
    searchParams.get('watchlistId')?.toLowerCase(),
  )

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))

  const entries = await prisma[typeFormatted].findMany({
    where: {
      watchlistId: watchlist.id,
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
