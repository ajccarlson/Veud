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

    let valueFormatted
    let columnName = searchParams.get('colId')

    if (searchParams.get('type') && searchParams.get('type') != "false" && searchParams.get('type') != "history") {
      valueFormatted = castType(searchParams.get('newValue'), searchParams.get('type'))
    }
    else if (searchParams.get('type') == "history") {
      const historyObject = await prisma[typeFormatted].findUnique({
        where: {
          id: searchParams.get('rowIndex'),
        },
      })

      let parsedObject = {}
      try {
        parsedObject = JSON.parse(historyObject.history)

        if (Object.keys(parsedObject).length < 1)
          throw new Error
      }
      catch(e) {
        parsedObject = {
          added: Date.now(),
          started: null,
          finished: null,
          progress: null,
          lastUpdated: Date.now(),
        }
      }

      if (searchParams.get('colId') == "length") {
        parsedObject["progress"] = JSON.parse(searchParams.get('newValue'))
      }
      else {
        parsedObject[searchParams.get('colId')] = new Date(searchParams.get('newValue')).toISOString()
      }
      
      valueFormatted = JSON.stringify(parsedObject)

      columnName = "history"
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
      },
    });
  }
  catch(e) {
    return e
  }
};
