import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar.tsx'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { type ProfileData } from '#app/utils/profile.ts'
// import { useOptionalUser } from '#app/utils/user.ts'

function getMonthName(monthNum: any) {
  const date = new Date(2000, monthNum - 1, 1)
  return date.toLocaleString('default', { month: 'long' })
}

export function SideData({ data: loaderData }: { data: ProfileData }) {
  const user = loaderData.user
  // const loggedInUser = useOptionalUser()
  // const isLoggedInUser = loaderData.user.id === loggedInUser?.id

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
    <div className="user-landing-side-container">
      <div className="user-landing-personal-container">
        <h1 className="user-landing-username">{user.username}</h1>
        <img
          src={getUserImgSrc(loaderData.user.image?.id)}
          alt={user.username}
          className="user-landing-profile-image"
        />
        <div className='user-landing-join-container'>
          <span className="user-landing-join-label">
            Joined
          </span>
          <span className="user-landing-join-date">
            {loaderData.userJoinedDisplay}
          </span>
        </div>
      </div>
      <div className="user-landing-nav-container-main">
        <Button asChild>
          <Link to={`../../lists/${user.username}`} prefetch="intent">
            Watchlists
          </Link>
        </Button>
        {/* {isLoggedInUser ? (
          <Button asChild>
            <Link to="/settings/profile" prefetch="intent">
              Edit profile
            </Link>
          </Button>
        ) : null} */}
      </div>
      {/* <div className="user-landing-nav-container-social">
        <Button asChild>
          <Link to="" prefetch="intent">
            Following
          </Link>
        </Button>
        {isLoggedInUser ? (
          <Button asChild>
            <Link to="" prefetch="intent">
              Messages
            </Link>
          </Button>
        ) :
        <Button asChild>
          <Link to="" prefetch="intent">
            Message
          </Link>
        </Button>
        }
      </div> */}
      <div className='user-landing-completion-history-container'>
        <h1 className="user-landing-body-header">Completion History</h1>
        <div className='user-landing-completion-history-chart'>
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
