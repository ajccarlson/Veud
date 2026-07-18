import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	requireEntryOwner,
	stripProtectedFields,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const rowIndex = searchParams.get('rowIndex')

  // The entry must belong to a watchlist the current user owns.
  await requireEntryOwner(request, rowIndex)

  let row: unknown
  try {
    row = JSON.parse(searchParams.get('row') ?? '')
  } catch {
    throw new Response('Invalid row payload', { status: 400 })
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Response('Invalid row payload', { status: 400 })
  }

  // A data update must not change the row's identity or move it to another watchlist
  // (which could be one the user doesn't own).
  const data = stripProtectedFields(row as Record<string, unknown>, [
    'id',
    'watchlistId',
  ])

  return await prisma.entry.update({
    where: { id: rowIndex as string },
    data: data as any,
  })
}
