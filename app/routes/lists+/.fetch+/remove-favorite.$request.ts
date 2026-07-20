<<<<<<< HEAD
import { type ActionFunctionArgs } from '@remix-run/node'
=======
import { type ActionFunctionArgs } from 'react-router'
>>>>>>> develop
import { prisma } from '#app/utils/db.server.ts'
import { requireFavoriteOwner } from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const id = searchParams.get('id')

  const { favorite } = await requireFavoriteOwner(request, id)

  return await prisma.userFavorite.delete({
    where: {
      id: favorite.id,
    },
  })
}
