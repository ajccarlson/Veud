import { type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireVisibleWatchlist } from '#app/utils/lists/visibility.server.ts'

export async function loader({ request, params }: LoaderFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const watchlistId = searchParams.get('watchlistId')?.toLowerCase()
  const { watchlist } = await requireVisibleWatchlist(request, watchlistId)

  return await prisma.entry.findMany({
    where: {
      watchlistId: watchlist.id,
    },
  })
}
