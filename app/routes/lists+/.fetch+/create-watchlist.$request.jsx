import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

function castType(varIn, varType) {
  let typeFormatted = varType.toLowerCase();

  if (typeFormatted.includes("bool"))
    return Boolean(varIn);
  else if (typeFormatted.includes("num") || typeFormatted.includes("int") || typeFormatted.includes("decimal"))
    return Number(varIn);
  else if (typeFormatted.includes("string") || typeFormatted.includes("text"))
    return String(varIn);
  else if (typeFormatted.includes("date") || typeFormatted.includes("time"))
    return new Date(varIn).toISOString();
  else if (typeFormatted.includes("undefined"))
    return undefined;
  else
    return varIn;
}

export async function action({ request, params }) {
  const userId = await requireUserId(request)
  const searchParams = new URLSearchParams(params.request)

  let rawList = JSON.parse(searchParams.get('list'))
  let formattedList = {}

  for (const [key, value] of Object.entries(rawList)) {
    formattedList[key] = await castType(value.value, value.type)
  }

  // The new watchlist is owned by its creator, regardless of any client-supplied value.
  formattedList.ownerId = userId

  return await prisma.watchlist.create({ data: formattedList });
}
