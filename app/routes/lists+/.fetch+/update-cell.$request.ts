import { type ActionFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireEntryOwner } from '#app/utils/lists/authorization.server.ts'

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
  try {
    const searchParams = new URLSearchParams(params.request)

    // Captured once up front. Each is `string | null`; the null handling below is
    // explicit and matches the original (repeated `searchParams.get()` calls returned
    // the same value anyway). The `as string` casts are runtime no-ops that preserve
    // behavior exactly — including the errors the inner try/catches deliberately swallow.
    const rowIndex = searchParams.get('rowIndex')
    const colId = searchParams.get('colId')
    const newValue = searchParams.get('newValue')
    const type = searchParams.get('type')
    const filter = searchParams.get('filter')
    const listTypeDataRaw = searchParams.get('listTypeData')

    // Reject a malformed listTypeData payload up front — a bad request must not be
    // swallowed into a 200 (the history/length branch below also relies on it parsing).
    try {
      JSON.parse(listTypeDataRaw ?? '')
    } catch {
      throw new Response('Invalid listTypeData', { status: 400 })
    }

    await requireEntryOwner(request, rowIndex)

    const historyObject: any = await prisma.entry.findUnique({
      where: {
        id: rowIndex as string,
      },
    })

    // The stored `history` is free-form JSON manipulated dynamically below, so it's `any`.
    let parsedHistoryObject: any = {}
    try {
      parsedHistoryObject = JSON.parse(historyObject.history)

      if (Object.keys(parsedHistoryObject).length < 1) throw new Error

      parsedHistoryObject.lastUpdated = Date.now()

      if (['length', 'chapters', 'volumes'].includes(colId as string)) {
        const lengthRegex = /\d+\s*\/\s*\d+ eps/g

        if (lengthRegex.test(newValue as string) || colId != 'length') {
          const mediaTotal = [...(newValue as string).matchAll(/\d+/g)]
          let matchResult: string | undefined

          try {
            matchResult = mediaTotal[0][0]
          } catch (e) {}

          if (matchResult) {
            if (!parsedHistoryObject.progress) {
              parsedHistoryObject.progress = {}
            }

            if (colId == 'length') {
              if (!parsedHistoryObject.progress[matchResult]) {
                parsedHistoryObject.progress[matchResult] = {
                  completed: false,
                  finishDate: [],
                }
              }

              parsedHistoryObject.progress[matchResult].completed = true
              parsedHistoryObject.progress[matchResult].finishDate.push(Date.now())
            } else {
              let mediaType: string
              const mediaTypeArray = JSON.parse(
                (JSON.parse(listTypeDataRaw as string) as { mediaType: string })
                  .mediaType,
              ) as string[]
              const mediaTypesFormatted = mediaTypeArray.map(
                (mediaTypeRaw) => `${mediaTypeRaw}s`,
              )
              const typeIndex = mediaTypesFormatted.findIndex((e) => e === colId)

              if (!mediaTypesFormatted || mediaTypesFormatted.length < 1) {
                mediaType = 'episode'
              } else if (typeIndex > 0) {
                mediaType = mediaTypeArray[typeIndex]
              } else {
                mediaType = mediaTypeArray[0]
              }

              if (!parsedHistoryObject.progress[mediaType]) {
                parsedHistoryObject.progress[mediaType] = {
                  [matchResult]: {
                    completed: false,
                    finishDate: [],
                  },
                }
              }

              if (!parsedHistoryObject.progress[mediaType][matchResult]) {
                parsedHistoryObject.progress[mediaType][matchResult] = {
                  completed: false,
                  finishDate: [],
                }
              }

              parsedHistoryObject.progress[mediaType][matchResult].completed = true
              parsedHistoryObject.progress[mediaType][matchResult].finishDate.push(
                Date.now(),
              )
            }
          }
        }

        return await prisma.entry.update({
          where: {
            id: rowIndex as string,
          },
          data: {
            history: JSON.stringify(parsedHistoryObject),
          },
        })
      }
    } catch (e) {
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

    let valueFormatted: unknown
    const columnName = colId

    if (type == 'history') {
      if (colId == 'length') {
        parsedHistoryObject['progress'] = JSON.parse(newValue as string)
      } else {
        parsedHistoryObject[colId as string] =
          newValue && newValue != 'null' ? new Date(newValue).toISOString() : null
      }

      return await prisma.entry.update({
        where: {
          id: rowIndex as string,
        },
        data: {
          history: JSON.stringify(parsedHistoryObject),
        },
      })
    } else {
      if (type && type != 'false') {
        valueFormatted = castType(newValue, type)
      } else {
        valueFormatted = castType(newValue, filter as string)
      }

      return await prisma.entry.update({
        where: {
          id: rowIndex as string,
        },
        data: {
          [columnName as string]: valueFormatted,
          history: JSON.stringify(parsedHistoryObject),
        } as any,
      })
    }
  } catch (e) {
    // Auth/ownership failures are already Responses (401/404) — let them through.
    if (e instanceof Response) throw e
    // Anything else is an unexpected server error: log it server-side and return a
    // generic 500 (never the raw error object, and never HTTP 200-on-failure).
    console.error('[update-cell] failed to update cell:', e)
    throw new Response('Failed to update cell', { status: 500 })
  }
}
