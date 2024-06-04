import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    return await prisma.userFavorite.create({ data: JSON.parse(searchParams.get('favorite')) });
  }
  catch(e) {
    return e
  }
};
