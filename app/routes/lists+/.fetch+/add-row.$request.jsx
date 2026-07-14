import { prisma } from '#app/utils/db.server.ts'
import {
  requireWatchlistOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))
  const row = JSON.parse(searchParams.get('row'))

  // The row may only be added to a watchlist the current user owns.
  await requireWatchlistOwner(request, row?.watchlistId)

  return await prisma[typeFormatted].create({ data: row })
}
