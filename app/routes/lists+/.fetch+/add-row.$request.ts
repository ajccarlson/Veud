import { type ActionFunctionArgs } from '@remix-run/node'
import { prisma } from '#app/utils/db.server.ts'
import {
  requireWatchlistOwner,
  resolveEntryModel,
  stripProtectedFields,
} from '#app/utils/lists/authorization.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
  const searchParams = new URLSearchParams(params.request)

  const typeFormatted = resolveEntryModel(searchParams.get('listTypeData'))

  let row: unknown
  try {
    row = JSON.parse(searchParams.get('row') ?? '')
  } catch {
    throw new Response('Invalid row payload', { status: 400 })
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Response('Invalid row payload', { status: 400 })
  }
  const rowObj = row as Record<string, unknown>

  // The row may only be added to a watchlist the current user owns.
  await requireWatchlistOwner(
    request,
    rowObj.watchlistId as string | null | undefined,
  )

  // The client must not choose the row's id — let the database generate it.
  const data = stripProtectedFields(rowObj, ['id'])

  // `typeFormatted` is allowlist-validated; the dynamic delegate access is intentional.
  return await (prisma as any)[typeFormatted].create({ data })
}
