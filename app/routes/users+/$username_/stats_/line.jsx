import { ResponsiveLine } from '@nivo/line'
import { getStartYear } from "#app/utils/lists/column-functions.jsx"

function MyResponsiveLine(data) {
  return (
    <div class="user-landing-stats-chart-container user-landing-stats-line-chart">
      <ResponsiveLine
        data={data}
        margin={{ top: 50, right: 110, bottom: 50, left: 60 }}
        xScale={{ type: 'point' }}
        yScale={{
            type: 'linear',
            min: 'auto',
            max: 'auto',
            stacked: false,
            reverse: false
        }}
        curve="monotoneX"
        // axisTop={null}
        // axisRight={null}
        // axisBottom={{
        //     tickSize: 5,
        //     tickPadding: 5,
        //     tickRotation: 0,
        //     legend: 'transportation',
        //     legendOffset: 36,
        //     legendPosition: 'middle',
        //     truncateTickAt: 0
        // }}
        // axisLeft={{
        //     tickSize: 5,
        //     tickPadding: 5,
        //     tickRotation: 0,
        //     legend: 'count',
        //     legendOffset: -40,
        //     legendPosition: 'middle',
        //     truncateTickAt: 0
        // }}
        enableGridX={false}
        enableGridY={false}
        pointSize={10}
        pointColor={{ theme: 'background' }}
        pointBorderWidth={2}
        pointBorderColor={{ from: 'serieColor' }}
        enablePointLabel={true}
        pointLabelYOffset={-12}
        enableArea={true}
        enableTouchCrosshair={true}
        useMesh={true}
        tooltip={(point) => {
          // console.log(point.point)
          return (
            <div
              style={{
                background: 'black',
                color: point.point.serieColor,
                padding: '9px 12px',
                border: '1px solid #ccc',
              }}
            >
              <div>{`${point.point.serieId}`}</div>
              <div>{`${point.point.data.x}: ${point.point.data.y}`}</div>
            </div>
          )
        }} 
        legends={[
          {
            anchor: 'left',
            direction: 'column',
            justify: false,
            translateX: 0,
            translateY: 56,
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

export function renderLineChart(loaderData, chartType) {
  let typedLines = []

  if (chartType == "release") {
    let lineData = {}


    Object.entries(loaderData.typedEntries).forEach(([key, value]) => {
      const foundListType = loaderData.listTypes.find(listType => listType.id == key)

      lineData = {
        id: foundListType.header,
        data: []
      }

      let entryData = []

      value.forEach(typedEntry => {
        let yearMatch =  [...getStartYear(typedEntry, foundListType, loaderData.listTypes).matchAll(/\d{4}/g)]
        let matchResult

        try {
          matchResult = yearMatch[0][0]
        } catch (e) {}
        
        if (matchResult) {
          const foundIndex = entryData.findIndex((element) => element.x == matchResult)
        
          if (foundIndex != -1) {
            entryData[foundIndex].y++
          }
          else {
            entryData.push ({
              x: Number(matchResult),
              y: 1
            })
          }
        }
      })

      lineData.data = entryData.sort(function(a, b) {
        var keyA = new Date(a.x),
        keyB = new Date(b.x);

        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        return 0;
      })

      typedLines.push(lineData)
    })
  }
  else if (chartType == "watched") {
    let lineData = {}


    Object.entries(loaderData.typedEntries).forEach(([key, value]) => {
      const foundListType = loaderData.listTypes.find(listType => listType.id == key)

      lineData = {
        id: foundListType.header,
        data: []
      }

      let entryData = []

      value.forEach(typedEntry => {
        let parsedYear

        try {
          if (typedEntry.history.finished == null || typedEntry.history.finished == 0)
            throw new Error

          parsedYear = new Date (typedEntry.history.finished).getFullYear()

          if (isNaN(parsedYear)) {
            throw new Error
          }
        }
        catch(e) {
          return
        }

        const foundIndex = entryData.findIndex((element) => element.x == parsedYear)
        
        if (foundIndex != -1) {
          entryData[foundIndex].y++
        }
        else {
          entryData.push ({
            x: Number(parsedYear),
            y: 1
          })
        }
      })

      lineData.data = entryData.sort(function(a, b) {
        var keyA = new Date(a.x),
        keyB = new Date(b.x);

        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        return 0;
      })

      typedLines.push(lineData)
    })
  }

  return (MyResponsiveLine(typedLines))
}
