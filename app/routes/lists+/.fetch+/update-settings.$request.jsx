import { prisma } from '#app/utils/db.server.ts'

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);
    let response = []

    for (const setting of JSON.parse(searchParams.get('settings'))) {
      response.push(await prisma.watchlist.update({
        where: {
          id: searchParams.get('listId'),
        },
        data: {
          [setting[0]]: setting[1],
        },
      }));
    }

    return response
  }
  catch(e) {
    return e
  }
};
