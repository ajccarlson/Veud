import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router'
import { ProfileAbout } from '#app/components/profile-about.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { StatsOverview } from '#app/routes/users+/$username_/stats-overview.tsx'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

function getMonthName(monthNum: any) {
  const date = new Date(2000, monthNum - 1, 1)
  return date.toLocaleString('default', { month: 'long' })
}

export default function ProfileOverview() {
  const loaderData = useOutletContext<ProfileData>()

  const completionHistory = renderCalendarChart(loaderData, "completion history")
  const completionYears = Object.keys(completionHistory)

  const [completionMonths, setCompletionMonths] = useState(Object.keys(completionHistory[completionYears[completionYears.length - 1]]))
  const [yearIndex, setYearIndex] = useState(completionYears.length - 1)
  const [monthIndex, setMonthIndex] = useState(completionMonths.length - 1)

  useEffect(() => {
    setMonthIndex(0)
    setCompletionMonths(Object.keys(completionHistory[completionYears[yearIndex]]))
  }, [yearIndex]);

  return (
    <div className="user-landing-overview">
      <ProfileAbout bio={loaderData.user.bio} />
      <StatsOverview data={loaderData} />
      <div className="user-landing-completion-history-container">
        <h1 className="user-landing-body-header">Completion History</h1>
        <div className="user-landing-completion-history-chart">
          {completionHistory[completionYears[yearIndex]][completionMonths[monthIndex]]}
        </div>
        <TypeSwitcher
          variant="primary"
          options={completionYears.map(year => ({ key: year, label: year }))}
          index={yearIndex}
          onIndexChange={setYearIndex}
        />
        <div className="user-landing-selection-secondary-nav-container">
          <Spacer size="4xs"/>
          <TypeSwitcher
            variant="secondary"
            options={completionMonths.map(month => ({ key: month, label: getMonthName(month) }))}
            index={monthIndex}
            onIndexChange={setMonthIndex}
          />
        </div>
      </div>
    </div>
  )
}
