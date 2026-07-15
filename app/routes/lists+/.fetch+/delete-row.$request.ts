import { type ActionFunctionArgs } from '@remix-run/node'
import { prisma } from '#app/utils/db.server.ts'
import {
  requireEntryOwner,
  resolveEntryModel,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))
  const id = searchParams.get('id')

  // The entry must belong to a watchlist the current user owns.
  await requireEntryOwner(request, typeFormatted, id)

  // `typeFormatted` is validated against the entry-model allowlist; the dynamic
  // delegate access is intentional and cannot be statically typed.
  return await (prisma as any)[typeFormatted].delete({
    where: {
      id,
    },
  })
}
