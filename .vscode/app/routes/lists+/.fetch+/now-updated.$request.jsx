import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'

export async function loader({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const watchlistId = searchParams.get('watchlistId')

  await requireWatchlistOwner(request, watchlistId)

  const now = new Date();

  return await prisma.watchlist.update({
    where: {
      id: watchlistId,
    },
    data: {
      updatedAt: now.toISOString(),
    },
  });
}
