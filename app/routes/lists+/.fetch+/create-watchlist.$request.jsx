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

export async function loader(params) {
  try {
    const searchParams = new URLSearchParams(params.params.request);

    if (!params.params.authorization || params.params.authorization != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

    let rawList = JSON.parse(searchParams.get('list'))
    let formattedList = {}

    for (const [key, value] of Object.entries(rawList)) {
      formattedList[key] = await castType(value.value, value.type)
    }

    return await prisma.watchlist.create({ data: formattedList });
  }
  catch(e) {
    return e
  }
};
