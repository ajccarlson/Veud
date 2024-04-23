import { ResponsiveCalendar } from '@nivo/calendar'

function MyResponsiveCalendar(data, startDate, endDate) {
  return (
    <div class="user-landing-stats-calendar-chart">
      <ResponsiveCalendar
          data={data}
          from={startDate}
          to={endDate}
          emptyColor="#eeeeee"
          colors={[ '#61cdbb', '#97e3d5', '#e8c1a0', '#f47560' ]}
          margin={{ top: 40, right: 40, bottom: 40, left: 40 }}
          yearSpacing={40}
          monthBorderColor="#ffffff"
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

function addDate(calendarHistory, watchDate) {
  const formattedDate = (new Date(watchDate)).toISOString().split('T')[0]
  
  let dayWatched

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

export function renderCalendarChart(loaderData, chartType) {
  let calendarHistory = []

  if (chartType == "episode history") {
    Object.entries(loaderData.typedEntries).forEach(([key, value]) => {
      value.forEach(typedEntry => {
        try {
          if (!typedEntry.history || typedEntry.history == null || typedEntry.history == "null") {
            return
          }
          else if (typedEntry.history.progress && typedEntry.history.progress != null && typedEntry.history.progress != "null" && Object.keys(typedEntry.history.progress).length > 1) {
            Object.entries(typedEntry.history.progress).forEach(([progressKey, progressValue]) => {
              progressValue.watchDate.forEach((watchDate) => {
                calendarHistory.push(addDate(calendarHistory, watchDate))
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

  let startDate = new Date(calendarHistory.reduce((acc, curr) => curr.day < acc.day ? curr : acc, calendarHistory[0] || undefined).day)
  let endDate = (new Date())

  let yearIterator = startDate.getFullYear()
  let endYear = endDate.getFullYear()

  let calendarArray = []

  while (yearIterator <= endYear) {
    calendarArray.push(MyResponsiveCalendar(calendarHistory, `${yearIterator}-01-01`, `${yearIterator + 1}-01-01`))
    yearIterator += 2
  }

  return (calendarArray)
}
