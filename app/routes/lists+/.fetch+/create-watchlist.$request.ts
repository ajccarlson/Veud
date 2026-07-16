import { type ActionFunctionArgs } from '@remix-run/node'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { stripProtectedFields } from '#app/utils/lists/authorization.server.ts'

function castType(varIn: unknown, varType: string): unknown {
  const typeFormatted = varType.toLowerCase()

  if (typeFormatted.includes('bool')) return Boolean(varIn)
  else if (
    typeFormatted.includes('num') ||
    typeFormatted.includes('int') ||
    typeFormatted.includes('decimal')
  )
    return Number(varIn)
  else if (typeFormatted.includes('string') || typeFormatted.includes('text'))
    return String(varIn)
  else if (typeFormatted.includes('date') || typeFormatted.includes('time'))
    return new Date(varIn as string | number | Date).toISOString()
  else if (typeFormatted.includes('undefined')) return undefined
  else return varIn
}

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  const searchParams = new URLSearchParams(params.request)

  let rawList: unknown
  try {
    rawList = JSON.parse(searchParams.get('list') ?? '')
  } catch {
    throw new Response('Invalid list payload', { status: 400 })
  }
  if (!rawList || typeof rawList !== 'object' || Array.isArray(rawList)) {
    throw new Response('Invalid list payload', { status: 400 })
  }

  const formattedList: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(
    rawList as Record<string, { value: unknown; type: string }>,
  )) {
    formattedList[key] = await castType(value.value, value.type)
  }

  // The client must not choose the watchlist id, and ownership always comes from the
  // session — never from a client-supplied value.
  const data = { ...stripProtectedFields(formattedList, ['id']), ownerId: userId }

  return await prisma.watchlist.create({ data: data as any })
}
