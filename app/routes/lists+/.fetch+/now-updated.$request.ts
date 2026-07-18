import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const watchlistId = searchParams.get('watchlistId')

  const { watchlist } = await requireWatchlistOwner(request, watchlistId)

  const now = new Date()

  return await prisma.watchlist.update({
    where: {
      id: watchlist.id,
    },
    data: {
      updatedAt: now.toISOString(),
    },
  })
}
