import { type ActionFunctionArgs } from '@remix-run/node'
import { prisma } from '#app/utils/db.server.ts'
import {
  requireWatchlistOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const { watchlist } = await requireWatchlistOwner(
    request,
    searchParams.get('watchlistId')?.toLowerCase(),
  )

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))

  // Dynamic (allowlisted) delegate access can't be statically typed; we only read the
  // few fields the emptiness check needs.
  const entries = (await (prisma as any)[typeFormatted].findMany({
    where: {
      watchlistId: watchlist.id,
    },
  })) as Array<{ id: string; title?: string | null; type?: string | null }>

  // An "empty" row has neither a meaningful title nor type.
  const removedEntries = entries.filter(
    entry =>
      (!entry.title || entry.title.replace(/\W/g, '') === '') &&
      (!entry.type || entry.type.replace(/\W/g, '') === ''),
  )

  // Remove them in a single atomic statement rather than one query per row.
  if (removedEntries.length > 0) {
    await (prisma as any)[typeFormatted].deleteMany({
      where: { id: { in: removedEntries.map(entry => entry.id) } },
    })
  }

  return removedEntries
}
