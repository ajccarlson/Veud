import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    return await prisma.LiveActionEntry.delete({
      where: {
        id: searchParams.get('id'),
      },
    });
  }
  catch(e) {
    return e
  }
};
