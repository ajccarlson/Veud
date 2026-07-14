import { prisma } from '#app/utils/db.server.ts'
import {
  requireEntryOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))
  const rowIndex = searchParams.get('rowIndex')

  // The entry must belong to a watchlist the current user owns.
  await requireEntryOwner(request, typeFormatted, rowIndex)

  return await prisma[typeFormatted].update({
    where: {
      id: rowIndex,
    },
    data: JSON.parse(searchParams.get('row'))
  });
}
