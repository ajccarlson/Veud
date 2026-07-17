import { ResponsiveTimeRange } from '@nivo/calendar'
import { veudChartColors, veudNivoTheme } from '#app/utils/nivo-theme.ts'

function MyResponsiveTimeRange(data: any, startDate: any, endDate: any) {
  return (
    <div className="user-landing-stats-calendar-chart">
      <ResponsiveTimeRange
        colors={veudChartColors}
        theme={veudNivoTheme}
          data={data}
          from={startDate}
          to={endDate}
          emptyColor="#eeeeee"
          // margin={{ top: 40, right: 40, bottom: 40, left: 40 }}
          align="center"
          direction="vertical"
          dayBorderWidth={2}
          dayBorderColor="#ffffff"
          tooltip={(point) => {
            // console.log(point)
            return (
              <div
                style={{
                  background: 'black',
                  color: point.color,
                  padding: '9px 12px',
                  border: '1px solid #ccc',
                }}
              >
              <div>{`${new Date(point.day).toLocaleDateString()}: ${point.value}`}</div>
              </div>
            )
          }} 
          legends={[
              {
                  anchor: 'bottom-right',
                  direction: 'row',
                  translateY: 36,
                  itemCount: 4,
                  itemWidth: 42,
                  itemHeight: 36,
                  itemsSpacing: 14,
                  itemDirection: 'right-to-left'
              }
          ]}
      />
    </div>
  )
}

function addDate(calendarHistory: any[], finishDate: any) {
  const formattedDate = (new Date(finishDate)).toISOString().split('T')[0]
  
  let dayWatched: any

  try {
    dayWatched = calendarHistory.find(e => e.day === formattedDate)
    
    if (!dayWatched) {
      throw new Error
    }
  } catch(e) {
    dayWatched = {
      value: 0,
      day: 0
    }
  }

  dayWatched.value++
  dayWatched.day = formattedDate

  return dayWatched
}

export function renderCalendarChart(loaderData: any, chartType: string) {
  let calendarHistory: any[] = []

  if (chartType == "completion history") {
    Object.entries(loaderData.typedEntries).forEach(([key, value]: [string, any]) => {
      value.forEach((typedEntry: any) => {
        try {
          if (!typedEntry.history || typedEntry.history == null || typedEntry.history == "null") {
            return
          }
          else if (typedEntry.history.progress && typedEntry.history.progress != null && typedEntry.history.progress != "null" && Object.keys(typedEntry.history.progress).length > 1) {
            Object.entries(typedEntry.history.progress).forEach(([progressKey, progressValue]: [string, any]) => {
              progressValue.finishDate.forEach((finishDate: any) => {
                calendarHistory.push(addDate(calendarHistory, finishDate))
              })
            })
          }
          else if (typedEntry.history.finished) {
            calendarHistory.push(addDate(calendarHistory, typedEntry.history.finished))
          }
        } catch(e) {
          return
        }
      })
    })
  }

  let startDate
  let endDate = (new Date())

  startDate = calendarHistory.length > 0 ? new Date(calendarHistory.reduce((acc, curr) => curr.day < acc.day ? curr : acc, calendarHistory[0] || undefined).day) : new Date()

  let yearIterator = startDate.getFullYear()
  let monthIterator = startDate.getMonth() + 1
  let endYear = endDate.getFullYear()
  let endMonth = endDate.getMonth() + 1

  let yearObject: Record<string, any> = {}
  
  while (yearIterator <= endYear) {
    let monthObject: Record<string, any> = {}

    while (monthIterator <= 12) {
      if (monthIterator > endMonth && yearIterator >= endYear) {
        break
      }

      monthObject[monthIterator] = MyResponsiveTimeRange(calendarHistory, `${yearIterator}-${monthIterator}-01`, `${yearIterator}-${monthIterator}-31`)
      monthIterator++
    }
    
    yearObject[yearIterator] = monthObject
    yearIterator++
    monthIterator = 1
  }

  return (yearObject)
}
