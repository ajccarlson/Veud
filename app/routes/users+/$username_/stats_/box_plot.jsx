import { ResponsiveBoxPlot } from '@nivo/boxplot'

function MyResponsiveBoxPlot(data) {
  return (
    <div class="user-landing-stats-chart-container user-landing-stats-box-plot-chart">
      <ResponsiveBoxPlot
          data={data}
          margin={{ top: 60, right: 140, bottom: 60, left: 60 }}
          minValue={0}
          maxValue={10}
          subGroupBy="group"
          padding={0.12}
          enableGridX={true}
          axisTop={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: '',
              legendOffset: 36,
              truncateTickAt: 0
          }}
          axisRight={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: '',
              legendOffset: 0,
              truncateTickAt: 0
          }}
          axisBottom={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: 'group',
              legendPosition: 'middle',
              legendOffset: 32,
              truncateTickAt: 0
          }}
          axisLeft={{
              tickSize: 5,
              tickPadding: 5,
              tickRotation: 0,
              legend: 'value',
              legendPosition: 'middle',
              legendOffset: -40,
              truncateTickAt: 0
          }}
          colors={{ scheme: 'nivo' }}
          colorBy="group"
          borderRadius={2}
          borderWidth={2}
          borderColor={{
              from: 'color',
              modifiers: [
                  [
                      'darker',
                      0.3
                  ]
              ]
          }}
          medianWidth={2}
          medianColor={{
              from: 'color',
              modifiers: [
                  [
                      'darker',
                      0.3
                  ]
              ]
          }}
          whiskerEndSize={0.6}
          whiskerColor={{
              from: 'color',
              modifiers: [
                  [
                      'darker',
                      0.3
                  ]
              ]
          }}
          motionConfig="stiff"
          tooltip={(point) => {
            //console.log(point)
            return (
              <div
                style={{
                  background: 'black',
                  color: point.color,
                  padding: '9px 12px',
                  border: '1px solid #ccc',
                }}
              >
                <div>{`${point.group} (${point.data.n})`}</div>
                <div>{`Mean: ${Number(point.formatted.mean).toFixed(1)}`}</div>
                <div>{`Min: ${point.data.extrema[0]}`}</div>
                <div>{`Max: ${point.data.extrema[1]}`}</div>
              </div>
            )
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
      />
    </div>
  )
}

export function renderBoxPlotChart(loaderData, chartType, listType) {
  if (chartType == "objective scores") {
    const typedEntry = loaderData.typedEntries[listType]

    let scoredBars = []
    for (let i = 0; i < 10; i++) {
      scoredBars[i] = {
        value: (i + 1),
        personal: []
      }
    }

    let objectiveType
    if (typedEntry[0]) {
      if ("tmdbScore" in typedEntry[0]) {
        objectiveType = "tmdbScore"
      }
      else if ("malScore" in typedEntry[0]) {
        objectiveType = "malScore"
      }
    }
    else {
      return
    }

    if (!objectiveType) {
      throw new Error ("No objective score type found!")
    }

    typedEntry.forEach(typedEntry => {
      if ((!isNaN(typedEntry[objectiveType]) && !isNaN(typedEntry["personal"])) && ((typedEntry[objectiveType] >= 1 && typedEntry[objectiveType] <= 10)  && (typedEntry["personal"] >= 1 && typedEntry["personal"] <= 10))) {
        scoredBars[Math.floor(typedEntry[objectiveType])]["personal"].push(typedEntry["personal"])
      }
    })

    let scoresFormatted = []
    for (const scoreBar of scoredBars) {
      if (scoreBar.personal.length > 0) {
        const dataLength = scoreBar.personal.length
        const dataAverage = scoreBar.personal.reduce((a, b) => Number(a) + Number(b)) / dataLength
        const stdDeviation = Math.sqrt(scoreBar.personal.map(x => Math.pow(x - dataAverage, 2)).reduce((a, b) => Number(a) + Number(b)) / dataLength)

        for (const personalScore of scoreBar.personal) {
          scoresFormatted.push({
            group: scoreBar.value,
            subgroup: scoreBar.value,
            value: personalScore,
            mu: dataAverage,
            sd: stdDeviation,
            n: dataLength,
          })
        }
      }
    }
    
    return MyResponsiveBoxPlot(scoresFormatted)
  }
}
