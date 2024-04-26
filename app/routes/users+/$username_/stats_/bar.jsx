import { ResponsiveBar } from '@nivo/bar'

function MyResponsiveBar(data, barKeys) {
  return (
    <div class="user-landing-stats-chart-container user-landing-stats-bar-chart">
      <ResponsiveBar
        data={data}
        keys={barKeys}
        indexBy="score"
        margin={{ top: 50, right: 130, bottom: 50, left: 60 }}
        padding={0.3}
        //groupMode="grouped"
        valueScale={{ type: 'linear' }}
        indexScale={{ type: 'band', round: true }}
        colors={{ scheme: 'nivo' }}
        defs={[
            {
                id: 'dots',
                type: 'patternDots',
                background: 'inherit',
                color: '#38bcb2',
                size: 4,
                padding: 1,
                stagger: true
            },
            {
                id: 'lines',
                type: 'patternLines',
                background: 'inherit',
                color: '#eed312',
                rotation: -45,
                lineWidth: 6,
                spacing: 10
            }
        ]}
        // fill={fill}
        tooltip={(point) => {
          console.log(point)
          return (
            <div
              style={{
                background: 'black',
                color: point.color,
                padding: '9px 12px',
                border: '1px solid #ccc',
              }}
            >
            <div>{`${point.indexValue}`}</div>
            <div>{`${point.id.charAt(0).toUpperCase() + point.id.slice(1)}: ${point.value}`}</div>
            </div>
          )
        }} 
        borderColor={{
            from: 'color',
            modifiers: [
                [
                    'darker',
                    1.6
                ]
            ]
        }}
        axisTop={null}
        axisRight={null}
        axisBottom={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            legend: 'country',
            legendPosition: 'middle',
            legendOffset: 32,
            truncateTickAt: 0
        }}
        axisLeft={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            legend: 'food',
            legendPosition: 'middle',
            legendOffset: -40,
            truncateTickAt: 0
        }}
        enableTotals={true}
        labelSkipWidth={12}
        labelSkipHeight={12}
        labelTextColor={{
            from: 'color',
            modifiers: [
                [
                    'darker',
                    1.6
                ]
            ]
        }}
        legends={[
          {
            anchor: 'bottom-right',
            direction: 'column',
            justify: false,
            translateX: 120,
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
        role="application"
        ariaLabel="Nivo bar chart demo"
        barAriaLabel={e=>e.id+": "+e.formattedValue+" in country: "+e.indexValue}
      />
    </div>
  )
}

export function renderBarChart(loaderData, chartType, listType) {
  if (chartType == "score") {
    const typedEntry = loaderData.typedEntries[listType]
    let scoredBars = [], barKeys= []
    for (let i = 0; i < 10; i++) {
      scoredBars[i] = {
        score: (i + 1)
      }
    }

    typedEntry.forEach(typedEntry => {
      Object.entries(typedEntry).forEach(([columnKey, columnValue]) => {
        if (!isNaN(columnValue) && !columnKey.toLowerCase().includes("date") && !columnKey.toLowerCase().includes("position") && !columnKey.toLowerCase().includes("volumes") && !columnKey.toLowerCase().includes("chapters") && !columnKey.toLowerCase().includes("episodes") && !columnKey.toLowerCase().includes("tmdb") && !columnKey.toLowerCase().includes("mal") && !columnKey.toLowerCase().includes("difference")) {
          if (!columnValue || columnValue == "null" || columnValue == 0)
            return

          if (columnValue >= 1 && columnValue <= 10) {
            if (barKeys.indexOf(columnKey) === -1)
              barKeys.push(columnKey)

            if (columnKey in scoredBars[Math.floor(columnValue - 1)]) {
              scoredBars[Math.floor(columnValue - 1)][columnKey]++
            }
            else {
              scoredBars[Math.floor(columnValue - 1)][columnKey] = 1
            }
          }
        }
      })
    })

    return MyResponsiveBar(scoredBars, barKeys)
  }
}
