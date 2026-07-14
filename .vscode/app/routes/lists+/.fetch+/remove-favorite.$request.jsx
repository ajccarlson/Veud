import { prisma } from '#app/utils/db.server.ts'
import { requireFavoriteOwner } from '#app/utils/lists/authorization.server.ts'

export async function loader({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const id = searchParams.get('id')

  await requireFavoriteOwner(request, id)

  return await prisma.userFavorite.delete({
    where: {
      id,
    },
  });
}
