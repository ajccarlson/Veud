import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function loader({ request, params }) {
  const userId = await requireUserId(request)
  const searchParams = new URLSearchParams(params.request)

  const favorite = JSON.parse(searchParams.get('favorite'))
  // Ownership comes from the session — never trust a client-supplied ownerId.
  return await prisma.userFavorite.create({
    data: { ...favorite, ownerId: userId },
  })
}
