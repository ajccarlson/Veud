import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!searchParams.get('authorization') || searchParams.get('authorization') != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    const typeFormatted = JSON.parse(searchParams.get('listTypeData')).header.replace(/\W/g, '') + "Entry"

    return await prisma[typeFormatted].delete({
      where: {
        id: searchParams.get('id'),
      },
    });
  }
  catch(e) {
    return e
  }
};
