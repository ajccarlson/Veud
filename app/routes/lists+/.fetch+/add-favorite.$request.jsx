import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!params.params.authorization || params.params.authorization != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    return await prisma.userFavorite.create({ data: JSON.parse(searchParams.get('favorite')) });
  }
  catch(e) {
    return e
  }
};
