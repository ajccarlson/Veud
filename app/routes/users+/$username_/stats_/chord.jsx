import { ResponsiveChord } from '@nivo/chord'

function MyResponsiveChord(data, keys) {
  return (
    <div class="user-landing-stats-chord-chart">
      <ResponsiveChord
        data={data}
        keys={keys}
        margin={{ top: 60, right: 60, bottom: 90, left: 60 }}
        valueFormat=".2f"
        padAngle={0.02}
        innerRadiusRatio={0.96}
        innerRadiusOffset={0.02}
        inactiveArcOpacity={0.25}
        arcBorderColor={{
            from: 'color',
            modifiers: [
                [
                    'darker',
                    0.6
                ]
            ]
        }}
        activeRibbonOpacity={0.75}
        inactiveRibbonOpacity={0.25}
        ribbonBorderColor={{
            from: 'color',
            modifiers: [
                [
                    'darker',
                    0.6
                ]
            ]
        }}
        labelRotation={-90}
        labelTextColor={{
            from: 'color',
            modifiers: [
                [
                    'darker',
                    1
                ]
            ]
        }}
        colors={{ scheme: 'nivo' }}
        motionConfig="stiff"
        ribbonTooltip={(point) => {
          // console.log(point.ribbon)
          return (
            <div
              style={{
                background: 'black',
                padding: '9px 12px',
                border: '1px solid #ccc',
              }}
            >
              <div style={{color: point.ribbon.source.color}}>{`${point.ribbon.source.label}: ${point.ribbon.source.value}`}</div>
              <div style={{color: point.ribbon.target.color}}>{`${point.ribbon.target.label}: ${point.ribbon.target.value}`}</div>
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

export function renderChordChart(loaderData) {
  let typedChords = []

  Object.entries(loaderData.typedEntries).forEach(([key, value]) => {
    let chordMatrix = []
    let chordIndices = []


    value.forEach(typedEntry => {
      let genreIndices = []

      typedEntry.genres.split(", ").forEach(entryGenre => {
        let genreIndex = chordIndices.indexOf(entryGenre)

        if (genreIndex == -1) {
          genreIndex = chordIndices.push(entryGenre) - 1
        }

        genreIndices.push(genreIndex)
      })

      genreIndices.forEach(genreIndex => {
        if (!chordMatrix[genreIndex]) {
          chordMatrix[genreIndex] = []
        }
        
        genreIndices.forEach(iteratedGenre => {
          if (!chordMatrix[genreIndex][iteratedGenre] && chordMatrix[genreIndex][iteratedGenre] != 0) {
            chordMatrix[genreIndex][iteratedGenre] = 0
          }
          else {
            chordMatrix[genreIndex][iteratedGenre]++
          }
        })
      })
    })

    chordMatrix.forEach(matrixRow => {
      for (let i = 0; i < chordMatrix.length; i++) {
        if (!matrixRow[i]) {
          matrixRow[i] = 0
        }
      }
    })
  
    typedChords.push(MyResponsiveChord(chordMatrix, chordIndices))
  })

  return typedChords
}
