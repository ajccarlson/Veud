import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    const typeFormatted = JSON.parse(searchParams.get('listTypeData')).header.replace(/\W/g, '') + "Entry"

    return await prisma[typeFormatted].create({ data: JSON.parse(searchParams.get('row')) });
  }
  catch(e) {
    return e
  }
};
