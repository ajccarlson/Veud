import { ResponsiveRadialBar } from '@nivo/radial-bar'

function MyResponsiveRadialBar(data)  {
  return (
    <div class="user-landing-stats-chart-container user-landing-stats-radial-bar-chart">
      <ResponsiveRadialBar
        data={data}
        padding={0.4}
        cornerRadius={2}
        margin={{ top: 40, right: 120, bottom: 40, left: 40 }}
        radialAxisStart={{ tickSize: 5, tickPadding: 5, tickRotation: 0 }}
        circularAxisOuter={{ tickSize: 5, tickPadding: 12, tickRotation: 0 }}
        enableLabels={true}
        tooltip={(point) => {
          // console.log(point.bar)
          return (
            <div
              style={{
                background: 'black',
                color: point.bar.color,
                padding: '9px 12px',
                border: '1px solid #ccc',
              }}
            >
              <div>{`${point.bar.groupId}`}</div>
              <div>{`${point.bar.category}: ${point.bar.value}`}</div>
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

export function renderRadialBar(loaderData, chartType) {
  let typedBars = []

  if (chartType == "type") {
    let barData = {}

    Object.entries(loaderData.typedEntries).forEach(([key, value]) => {
      const foundListType = loaderData.listTypes.find(listType => listType.id == key)

      barData = {
        id: foundListType.header,
        data: []
      }

      let entryData = []

      value.forEach(typedEntry => {
        if (!typedEntry.type || typedEntry.type == "null")
          return

        const foundIndex = entryData.findIndex((element) => element.x == typedEntry.type)
        
        if (foundIndex != -1) {
          entryData[foundIndex].y++
        }
        else {
          entryData.push ({
            x: typedEntry.type,
            y: 1
          })
        }
      })

      barData.data = entryData.sort(function(a, b) {
        var keyA = new Date(a.x),
        keyB = new Date(b.x);

        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        return 0;
      })

      typedBars.push(barData)
    })
  }

  return (MyResponsiveRadialBar(typedBars))
}
