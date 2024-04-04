import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    const now = new Date();

    return await prisma.watchlist.update({
      where: {
        id: searchParams.get('watchlistId'),
      },
      data: {
        updatedAt: now.toISOString(),
      },
    });
  }
  catch(e) {
    return e
  }
};
