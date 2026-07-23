import { ResponsiveWaffle } from '@nivo/waffle'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'

function MyResponsiveWaffle (data: any, waffleDimensions: any) {
  return (
    <div className="user-landing-stats-waffle-chart">
      <ResponsiveWaffle
        colors={veudChartColors}
        theme={veudNivoTheme}
          data={data}
          total={100}
          rows={waffleDimensions.x}
          columns={waffleDimensions.y}
          padding={1}
          valueFormat=".2f"
          margin={{ top: 10, right: 10, bottom: 10, left: 120 }}
          tooltip={(point: any) => {
            // console.log(point)
            return (
              <div
                style={{
                  background: 'black',
                  color: point.data.color,
                  padding: '9px 12px',
                  border: '1px solid #ccc',
                }}
              >
                <div>{`${point.data.label}: ${point.data.data.total}`}</div>
                <center>{`(${point.data.formattedValue}%)`}</center>
              </div>
            )
          }} 
          borderRadius={3}
          borderColor={{
              from: 'color',
              modifiers: [
                  [
                      'darker',
                      0.3
                  ]
              ]
          }}
          motionStagger={2}
          legends={[
          {
            anchor: 'top-left',
                  direction: 'column',
            justify: false,
            translateX: -100,
            translateY: 0,
            itemsSpacing: 10,
            itemWidth: 100,
            itemHeight: 18,
            itemTextColor: 'white',
            itemDirection: 'left-to-right',
            itemOpacity: 1,
            symbolSize: 18,
            symbolShape: 'square',
            effects: [
              {
                on: 'hover',
                style: {
                  itemTextColor: '#66563d'
                }
              }
            ]
          }
        ]}
    />
    </div>
  )
}

export function watchlistOverview(loaderData: any, listType: any) {
  let scoredEntries = 0, listSum = 0

  let typedLists: Record<string, number> = {}
  let mediaCount: Record<string, number> = {}

  if (loaderData.typedEntries[listType.id] && loaderData.typedEntries[listType.id].length > 0) {
    loaderData.typedEntries[listType.id].forEach((typedEntry: any) => {
      if (!typedLists[typedEntry.watchlistId] && typedLists[typedEntry.watchlistId] != 0) {
        typedLists[typedEntry.watchlistId] = 1
      }
      else {
        typedLists[typedEntry.watchlistId]++
      }
  
      if (typedEntry.personal && typedEntry.personal > 0) {
        scoredEntries++
      }
  
      (JSON.parse(listType.mediaType) as any[]).forEach(mediaIter => {
        let historyLength = 0, finishedLength = 0, seriesLength = 1
        const iterPlural = (String(mediaIter) + 's')
        let iterType = typedEntry[iterPlural] ? iterPlural : "length"
  
        // typedEntry[iterType].match(/(\d+h+)*\s*(\d+m+)*/g)
  
        if (typedEntry[iterType]) {
          if (typedEntry.type != "Movie") {
            try {
              seriesLength = Math.max(Number([...typedEntry[iterType].matchAll(/\d+/g)].slice(-1)[0][0]), seriesLength)
            }
            catch {}
          }
        }
  
        if (!seriesLength || isNaN(seriesLength)) {
          seriesLength = 1
        }
  
        if(typedEntry.history.finished && typedEntry.history.finished != "null" && typedEntry.history.finished != "NULL" && typedEntry.history.finished != 0) {
          finishedLength = seriesLength
        }
  
        if (typedEntry.history.progress) {
          let maxHistory = 0
          let maxRewatch = {
            latest: 0,
            times: 0
          }
  
          const progressType = iterType == "length" ? typedEntry.history.progress : typedEntry.history.progress[mediaIter]
  
          if (progressType && Object.entries(progressType).length > 0) {
            (Object.entries(progressType) as any).findLast(([progressKey, progressValue]: [string, any]) => {
              const progressNum = Number(progressKey)
    
              maxHistory = progressNum > maxHistory ? progressNum : maxHistory
    
              if (progressValue.finishDate && progressValue.finishDate.length > 1) {
                if (!typedEntry.history.finished || typedEntry.history.finished == null || typedEntry.history.finished == 0) {
                  historyLength += (progressValue.finishDate.length - 1)
                }
                else if (progressValue.finishDate.length > maxRewatch.times && progressNum > maxRewatch.latest) {
                  maxRewatch.latest = progressNum
                  maxRewatch.times = progressValue.finishDate.length
                }
              }

              return null
            })
          }
  
          const additionalRewatches = maxRewatch.times > 0 ? ((maxRewatch.times - 1) * seriesLength) : 0
  
          historyLength += (maxHistory + (maxRewatch.latest + additionalRewatches))
        }
  
        if (!mediaCount[mediaIter] && mediaCount[mediaIter] != 0) {
          mediaCount[mediaIter] = 0
        }
  
        const entryMax = Math.max(historyLength, finishedLength)
  
        if (!isNaN(entryMax) && entryMax > 0) {
          mediaCount[mediaIter] += entryMax
        }
      })
  
      listSum += Number(typedEntry.personal)
    })
  }

  let listAverage: number | string = listSum / scoredEntries
  listAverage = isNaN(listAverage) ? "N/A": listAverage.toFixed(2)

  let waffleData: any[] = []
  const typedListsObject = Object.entries(typedLists)
  let smallestPercentage = 100
  
  typedListsObject.forEach(([typedKey, typedValue]: [string, any]) => {
    const typedList = loaderData.watchLists.find((watchList: any) => watchList.id == typedKey)
    let wafflePercent = (typedValue / loaderData.typedEntries[listType.id].length) * 100
    smallestPercentage = wafflePercent < smallestPercentage ? wafflePercent : smallestPercentage

    waffleData[(typedListsObject.length) - typedList.position] = {
      id: typedList.name,
      label: typedList.header,
      value: wafflePercent,
      total: typedValue
    }
  })

  const waffleRoot = Math.ceil(Math.sqrt(100 / smallestPercentage))
  const waffleSide = waffleRoot > 10 ? waffleRoot : 10

  const waffleDimensions = {
    x: waffleSide,
    y: waffleSide
  }

  return (
    <div className="user-landing-stats-chart-container user-landing-stats-waffle-chart-container">
      <div className="user-landing-stats-waffle-chart-text-container">
        <div className="user-landing-stats-waffle-chart-text-left">
          <span>{`Total Entries: ${loaderData.typedEntries[listType.id] ? loaderData.typedEntries[listType.id].length : 0}`}</span>
        </div>
        <div className="user-landing-stats-waffle-chart-text-right">
          {`Mean Score: ${listAverage}`}
          <div>
            {Object.entries(mediaCount).map(([typeKey, typeValue]: [string, any]) => {
              return (
                <div key={typeKey}>
                  <span>{`${typeValue} ${(typeKey.charAt(0).toUpperCase() + typeKey.substr(1)).split(/(?=[A-Z])/).join(" ")}s ${((JSON.parse(listType.completionType) as any).past.charAt(0).toUpperCase() + (JSON.parse(listType.completionType) as any).past.substr(1)).split(/(?=[A-Z])/).join(" ")}`}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {MyResponsiveWaffle(waffleData, waffleDimensions)}
    </div>
  )
}
