import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'
import { deleteTrackingStateIfOrphan } from '#app/utils/tracking-state.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const { watchlist } = await requireWatchlistOwner(
    request,
    searchParams.get('watchlistId')?.toLowerCase(),
  )

  const entries = await prisma.entry.findMany({
    where: {
      watchlistId: watchlist.id,
    },
  })

  // An "empty" row has neither a meaningful title nor type.
  const removedEntries = entries.filter(
    entry =>
      (!entry.title || entry.title.replace(/\W/g, '') === '') &&
      (!entry.type || entry.type.replace(/\W/g, '') === ''),
  )

  // Remove them in a single atomic statement rather than one query per row.
  if (removedEntries.length > 0) {
    await prisma.$transaction(async tx => {
      await tx.entry.deleteMany({
        where: { id: { in: removedEntries.map(entry => entry.id) } },
      })
      for (const trackingStateId of new Set(
        removedEntries.map(entry => entry.trackingStateId).filter(Boolean),
      )) {
        await deleteTrackingStateIfOrphan(tx, trackingStateId)
      }
    })
  }

  return removedEntries
}
