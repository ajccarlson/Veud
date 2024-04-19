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
    const typeFormatted = JSON.parse(searchParams.get('listTypeData')).header.replace(/\W/g, '') + "Entry"

    const historyObject = await prisma[typeFormatted].findUnique({
      where: {
        id: searchParams.get('rowIndex'),
      },
    })

    let parsedHistoryObject = {}
    try {
      parsedHistoryObject = JSON.parse(historyObject.history)

      if (Object.keys(parsedHistoryObject).length < 1)
        throw new Error

      parsedHistoryObject.lastUpdated = Date.now()
    }
    catch(e) {
      parsedHistoryObject = {
        added: Date.now(),
        started: null,
        finished: null,
        progress: null,
        lastUpdated: Date.now(),
      }
    }

    let valueFormatted
    let columnName = searchParams.get('colId')

    if (searchParams.get('type') == "history") {
      if (searchParams.get('colId') == "length") {
        parsedHistoryObject["progress"] = JSON.parse(searchParams.get('newValue'))
      }
      else {
        parsedHistoryObject[searchParams.get('colId')] = new Date(searchParams.get('newValue')).toISOString()
      }

      return await prisma[typeFormatted].update({
        where: {
          id: searchParams.get('rowIndex'),
        },
        data: {
          history: JSON.stringify(parsedHistoryObject),
        },
      });
    }
    else {
      if (searchParams.get('type') && searchParams.get('type') != "false") {
        valueFormatted = castType(searchParams.get('newValue'), searchParams.get('type'))
      }
      else {
        valueFormatted = castType(searchParams.get('newValue'), searchParams.get('filter'))
      }

      return await prisma[typeFormatted].update({
        where: {
          id: searchParams.get('rowIndex'),
        },
        data: {
          [columnName]: valueFormatted,
          history: JSON.stringify(parsedHistoryObject),
        },
      });
    }
  }
  catch(e) {
    return e
  }
};
