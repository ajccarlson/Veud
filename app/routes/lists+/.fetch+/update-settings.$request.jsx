import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { requireWatchlistOwner } from '#app/utils/lists/authorization.server.ts'

// Only these watchlist fields may be changed via the settings form. Everything else
// (id, position, typeId, ownerId, timestamps, relations) is off-limits, so a client can't
// reassign ownership or move a list between types by injecting extra keys.
const EDITABLE_SETTINGS = ['name', 'header', 'displayedColumns', 'description']

// `settings` arrives as a JSON array of [key, value] pairs.
const SettingsSchema = z.array(z.tuple([z.string(), z.unknown()]))

export async function action({ request, params }) {
  const searchParams = new URLSearchParams(params.request)

  const listId = searchParams.get('listId')

  // Only the owner may change this watchlist's settings.
  const { userId, watchlist } = await requireWatchlistOwner(request, listId)

  let rawSettings
  try {
    rawSettings = JSON.parse(searchParams.get('settings'))
  } catch {
    throw new Response('Invalid settings payload', { status: 400 })
  }
  const parsedSettings = SettingsSchema.safeParse(rawSettings)
  if (!parsedSettings.success) {
    throw new Response('Invalid settings payload', { status: 400 })
  }

  let typeId
  try {
    typeId = JSON.parse(searchParams.get('listTypeData'))?.id
  } catch {
    throw new Response('Invalid listTypeData', { status: 400 })
  }
  if (typeof typeId !== 'string') {
    throw new Response('Invalid listTypeData', { status: 400 })
  }

  // Whitelist: keep only editable fields, dropping any others (mass-assignment guard).
  const data = {}
  for (const [key, value] of parsedSettings.data) {
    if (EDITABLE_SETTINGS.includes(key)) {
      data[key] = value
    }
  }

  // Apply the (whitelisted) settings and renumber the owner's watchlists of this type
  // atomically, so a failure can't leave settings half-applied or the ordering off.
  const updated = await prisma.$transaction(async (tx) => {
    const result =
      Object.keys(data).length > 0
        ? await tx.watchlist.update({ where: { id: listId }, data })
        : watchlist

    const remaining = await tx.watchlist.findMany({
      where: { typeId, ownerId: userId },
      orderBy: { position: 'asc' },
    })

    for (let i = 0; i < remaining.length; i++) {
      await tx.watchlist.update({
        where: { id: remaining[i].id },
        data: { position: i + 1 },
      })
    }

    return result
  })

  // The client reads the updated watchlist as the last element of the returned array.
  return [updated]
}
