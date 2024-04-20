import { invariantResponse } from '@epic-web/invariant'
import { json } from '@remix-run/node'
import { useEffect, useState } from 'react'
import { Form, Link, useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { timeSince, hyperlinkRenderer } from "#app/utils/lists/column-functions.tsx"
import { prisma } from '#app/utils/db.server.ts'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { useOptionalUser } from '#app/utils/user.ts'
import "#app/styles/user-landing.scss"

export function SideData(loaderData) {
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	return (
		<div className="user-landing-side-container">
			<div className="user-landing-personal-container">
				<img
					src={getUserImgSrc(loaderData.user.image?.id)}
					alt={user.username}
					className="user-landing-profile-image"
				/>
				<h1 className="user-landing-username">{user.username}</h1>
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
			<div className="user-landing-nav-container-sub">
				<Button asChild>
					<Link to="" prefetch="intent">
						Stats
					</Link>
				</Button>
				<Button asChild>
					<Link to="" prefetch="intent">
						History
					</Link>
				</Button>
			</div>
			<div className="user-landing-nav-container-social">
				<Button asChild>
					<Link to="" prefetch="intent">
						Friends
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
		</div>
	)
}