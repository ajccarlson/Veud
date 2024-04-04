import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request)

    return await prisma[searchParams.get('listType')].create({ data: JSON.parse(searchParams.get('row')) });
  }
  catch(e) {
    return e
  }
};
