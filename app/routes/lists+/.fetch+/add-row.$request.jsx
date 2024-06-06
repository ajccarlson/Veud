import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!params.params.authorization || params.params.authorization != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    const typeFormatted = JSON.parse(searchParams.get('listTypeData')).header.replace(/\W/g, '') + "Entry"

    return await prisma[typeFormatted].create({ data: JSON.parse(searchParams.get('row')) });
  }
  catch(e) {
    return e
  }
};
