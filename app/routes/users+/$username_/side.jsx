import { Link } from '@remix-run/react'
import { useState, useEffect } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { renderCalendarChart } from '#app/routes/users+/$username_/stats_/calendar'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { useOptionalUser } from '#app/utils/user.ts'

export function SideData(loaderData) {
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loaderData.user.id === loggedInUser?.id



  const watchHistory = renderCalendarChart(loaderData, "completion history")
  const watchYears = Object.keys(watchHistory)
  const [calendarIndex, setCalendarIndex] = useState(0);

	return (
		<div className="user-landing-side-container">
			<div className="user-landing-personal-container">
        <h1 className="user-landing-username">{user.username}</h1>
				<img
					src={getUserImgSrc(loaderData.user.image?.id)}
					alt={user.username}
					className="user-landing-profile-image"
				/>
				<p className="user-landing-join-date">
					Joined {loaderData.userJoinedDisplay}
				</p>
			</div>
			<div className="user-landing-nav-container-main">
				<Button asChild>
					<Link to={`../../lists/${user.username}`} prefetch="intent">
						Watchlists
					</Link>
				</Button>
				<Button asChild>
					<Link to="notes" prefetch="intent">
						Notes
					</Link>
				</Button>
				{isLoggedInUser ? (
					<Button asChild>
						<Link to="/settings/profile" prefetch="intent">
							Edit profile
						</Link>
					</Button>
				) : null}
			</div>
			<div className="user-landing-nav-container-social">
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
			</div>
      <div className='user-landing-watch-history-container'>
        <h1 className="user-landing-body-header">Watch History</h1>
        <div className='user-landing-watch-history-chart'>
          {watchHistory[calendarIndex].chart}
        </div>
        <div className="user-landing-selection-nav-container">
          <button onClick={() => {setCalendarIndex(calendarIndex == 0 ? watchYears.length - 1 : calendarIndex - 1)}}>
            <Icon name="triangle-left" className="user-landing-nav-arrow user-landing-left-arrow"></Icon>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="user-landing-dropdown-trigger"> 
                {watchHistory[calendarIndex].year}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuPortal className="user-landing-dropdown-portal">
              <DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
                {Object.entries(watchHistory).filter(function([eKey, eValue]) { return eValue.header !== watchHistory[calendarIndex].year }).map(([calendarKey, calendarValue]) =>
                  <DropdownMenuItem className="user-landing-dropdown-item" onClick={() =>
                    {
                      setCalendarIndex(watchYears.indexOf(calendarKey))
                    }}>
                    {calendarValue.year}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <button onClick={() => {setCalendarIndex((calendarIndex + 1) % (watchYears.length))}}>
            <Icon name="triangle-right" className="user-landing-nav-arrow user-landing-right-arrow"></Icon>
          </button>
        </div>
      </div>
		</div>
	)
}