import { type ActionFunctionArgs } from '@remix-run/node'
import { prisma } from '#app/utils/db.server.ts'
import {
  requireEntryOwner,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const id = searchParams.get('id')

  // The entry must belong to a watchlist the current user owns.
  await requireEntryOwner(request, id)

  return await prisma.entry.delete({
    where: {
      id: id as string,
    },
  })
}
