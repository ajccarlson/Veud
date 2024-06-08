import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!searchParams.get('authorization') || searchParams.get('authorization') != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    return await prisma.userFavorite.delete({
      where: {
        id: searchParams.get('id'),
      },
    });
  }
  catch(e) {
    return e
  }
};
