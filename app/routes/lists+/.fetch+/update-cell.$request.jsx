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

    if (!searchParams.get('authorization') || searchParams.get('authorization') != process.env.VEUD_API_KEY) {
      throw new Error("Error: invalid authorization!")
    }

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

      if (["length", "chapters", "volumes"].includes(searchParams.get('colId'))) {
        const lengthRegex = /\d+\s*\/\s*\d+ eps/g

        if (lengthRegex.test(searchParams.get('newValue')) || searchParams.get('colId') != "length") {
          const mediaTotal = [...searchParams.get('newValue').matchAll(/\d+/g)]
          let matchResult

          try {
            matchResult = mediaTotal[0][0]
          } catch(e) {}

          if (matchResult) {
            if (!parsedHistoryObject.progress) {
              parsedHistoryObject.progress = {}
            }

            if (searchParams.get('colId') == "length") {
              if (!parsedHistoryObject.progress[matchResult]) {
                parsedHistoryObject.progress[matchResult] = {
                  completed: false,
                  finishDate: []
                }
              }
              
              parsedHistoryObject.progress[matchResult].completed = true
              parsedHistoryObject.progress[matchResult].finishDate.push(Date.now())
            }
            else {
              let mediaType
              const mediaTypeArray = JSON.parse(JSON.parse(searchParams.get('listTypeData')).mediaType)
              const mediaTypesFormatted = mediaTypeArray.map(mediaTypeRaw => `${mediaTypeRaw}s`)
              const typeIndex = mediaTypesFormatted.findIndex(e => e === searchParams.get('colId'))

              if (!mediaTypesFormatted || mediaTypesFormatted.length < 1) {
                mediaType = "episode"
              }
              else if (typeIndex > 0) {
                mediaType = mediaTypeArray[typeIndex]
              }
              else {
                mediaType = mediaTypeArray[0]
              }

              if (!parsedHistoryObject.progress[mediaType]) {
                parsedHistoryObject.progress[mediaType] = {
                  [matchResult]: {
                    completed: false,
                    finishDate: []
                  }
                }
              }

              if (!parsedHistoryObject.progress[mediaType][matchResult]) {
                parsedHistoryObject.progress[mediaType][matchResult] = {
                  completed: false,
                  finishDate: []
                }
              }
              
              parsedHistoryObject.progress[mediaType][matchResult].completed = true
              parsedHistoryObject.progress[mediaType][matchResult].finishDate.push(Date.now())
            }
          }
        }

        return await prisma[typeFormatted].update({
          where: {
            id: searchParams.get('rowIndex'),
          },
          data: {
            history: JSON.stringify(parsedHistoryObject),
          },
        })
      }
    }
    catch(e) {
      if (!parsedHistoryObject) {
        parsedHistoryObject = {
          added: Date.now(),
          started: null,
          finished: null,
          progress: null,
          lastUpdated: Date.now(),
        }
      }
    }

    let valueFormatted
    let columnName = searchParams.get('colId')

    if (searchParams.get('type') == "history") {
      if (searchParams.get('colId') == "length") {
        parsedHistoryObject["progress"] = JSON.parse(searchParams.get('newValue'))
      }
      else {
        parsedHistoryObject[searchParams.get('colId')] = searchParams.get('newValue') && searchParams.get('newValue') != "null" ? new Date(searchParams.get('newValue')).toISOString() : null
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
      })
    }
  }
  catch(e) {
    return e
  }
};
