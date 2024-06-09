import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { Spacer } from '#app/components/spacer.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar'
import { getUserImgSrc } from '#app/utils/misc.tsx'
// import { useOptionalUser } from '#app/utils/user.ts'

function getMonthName(monthNum) {
  const date = new Date(2000, monthNum - 1, 1)
  return date.toLocaleString('default', { month: 'long' })
}

export function SideData(loaderData) {
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
				{/* <Button asChild>
					<Link to="notes" prefetch="intent">
						Notes
					</Link>
				</Button> */}
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
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setYearIndex(yearIndex == 0 ? completionYears.length - 1 : yearIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-left-arrow"></Icon>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="user-landing-dropdown-trigger"> 
                {completionYears[yearIndex]}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuPortal className="user-landing-dropdown-portal">
              <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                {completionYears.filter((year) => year !== completionYears[yearIndex]).map(completionYear =>
                  <DropdownMenuItem className="user-landing-dropdown-item" key={completionYear} onClick={() =>
                    {
                      setYearIndex(completionYears.indexOf(completionYear))
                    }}>
                    {completionYear}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setYearIndex((yearIndex + 1) % (completionYears.length))}}>
            <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-right-arrow"></Icon>
          </button>
        </div>
        <div className="user-landing-selection-secondary-nav-container">
          <Spacer size="4xs"/>
          <div className="user-landing-selection-nav-container">
            <button onClick={() => {setMonthIndex(monthIndex == 0 ? completionMonths.length - 1 : monthIndex - 1)}}>
              <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-secondary-left-arrow"></Icon>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="user-landing-secondary-dropdown-trigger"> 
                  {getMonthName(completionMonths[monthIndex])}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuPortal className="user-landing-dropdown-portal">
                <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                  {completionMonths.filter((month) => month !== completionMonths[monthIndex] ).map(completionMonth =>
                    <DropdownMenuItem className="user-landing-dropdown-item" key={completionMonth} onClick={() =>
                      {
                        setMonthIndex(completionMonths.indexOf(completionMonth))
                      }}>
                      {getMonthName(completionMonth)}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
            <button onClick={() => {setMonthIndex((monthIndex + 1) % (completionMonths.length))}}>
              <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-secondary-right-arrow"></Icon>
            </button>
          </div>
        </div>
      </div>
		</div>
	)
}