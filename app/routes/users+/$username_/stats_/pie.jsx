import { ResponsivePie } from '@nivo/pie'

export function MyResponsivePie(data, fill) {
  return (
    <ResponsivePie
    data={data}
    margin={{ top: 40, right: 80, bottom: 80, left: 80 }}
    sortByValue={true}
      innerRadius={0.5}
      padAngle={0.7}
      cornerRadius={3}
      activeOuterRadiusOffset={8}
      colors={{ scheme: 'set3' }}
      borderWidth={1}
      borderColor={{
      from: 'color',
      modifiers: [
        [
          'darker',
          0.2
        ]
      ]
      }}
      arcLinkLabelsSkipAngle={10}
      arcLinkLabelsTextColor="white"
      arcLinkLabelsThickness={2}
      arcLinkLabelsColor="white"
      arcLabelsSkipAngle={10}
      arcLabelsTextColor="black"
      tooltip={(point) => {
      //console.log(point.datum)
      return (
        <div
          style={{
          background: 'black',
            color: point.datum.color,
              padding: '9px 12px',
              border: '1px solid #ccc',
            }}
          >
            <div>{`${point.datum.label}: ${point.datum.formattedValue}`}</div>
          </div>
        )
      }} 
      defs={[
        {
          id: 'dots',
          type: 'patternDots',
          background: 'inherit',
          color: 'rgba(255, 255, 255, 0.3)',
          size: 4,
          padding: 1,
          stagger: true
        },
        {
          id: 'lines',
          type: 'patternLines',
          background: 'inherit',
          color: 'rgba(255, 255, 255, 0.3)',
          rotation: -45,
          lineWidth: 6,
          spacing: 10
        }
      ]}
      fill={fill}
      motionConfig="default"
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
  )
}
