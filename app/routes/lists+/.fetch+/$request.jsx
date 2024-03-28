import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  const searchParams = new URLSearchParams(params.params.request);

  return await prisma.watchEntry.update({
    where: {
      id: searchParams.get('rowIndex'),
    },
    data: {
      [searchParams.get('colId')]: searchParams.get('newValue'),
    },
  });
};
