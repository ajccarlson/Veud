import { prisma } from '#app/utils/db.server.ts'
import {
  requireWatchlistOwner,
  resolveEntryModel,
  stripProtectedFields,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))

  let row
  try {
    row = JSON.parse(searchParams.get('row'))
  } catch {
    throw new Response('Invalid row payload', { status: 400 })
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Response('Invalid row payload', { status: 400 })
  }

  // The row may only be added to a watchlist the current user owns.
  await requireWatchlistOwner(request, row.watchlistId)

  // The client must not choose the row's id — let the database generate it.
  const data = stripProtectedFields(row, ['id'])

  return await prisma[typeFormatted].create({ data })
}
