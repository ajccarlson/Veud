import { prisma } from '#app/utils/db.server.ts'
import {
  requireEntryOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function loader({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))
  const id = searchParams.get('id')

  // The entry must belong to a watchlist the current user owns.
  await requireEntryOwner(request, typeFormatted, id)

  return await prisma[typeFormatted].delete({
    where: {
      id,
    },
  });
}
