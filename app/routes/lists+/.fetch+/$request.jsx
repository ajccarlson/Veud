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
    return Date(varIn);
  else if (typeFormatted.includes("undefined"))
    return undefined;
  else
    return varIn;
}

export async function loader(params) {
  const searchParams = new URLSearchParams(params.params.request);

  let valueFormatted;
  if (searchParams.get('type') && searchParams.get('type') != "false")
    valueFormatted = castType(searchParams.get('newValue'), searchParams.get('type'));
  else
    valueFormatted = castType(searchParams.get('newValue'), searchParams.get('filter'));

  return await prisma.watchEntry.update({
    where: {
      id: searchParams.get('rowIndex'),
    },
    data: {
      [searchParams.get('colId')]: valueFormatted,
    },
  });
};
