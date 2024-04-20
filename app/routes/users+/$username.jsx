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

function SideData() {
	const loaderData = useLoaderData()
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

function RecentActivityData() {
	const loaderData = useLoaderData()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	const [selectedLatestUpdate, setSelectedLatestUpdate] = useState(loaderData.listTypes[0]);

	return (
		<div className="user-landing-recent-activity-container">
			<h1 className="user-landing-body-header">Recent Activity</h1>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<div className="user-landing-dropdown-trigger"> 
						{selectedLatestUpdate.header}
					</div>
				</DropdownMenuTrigger>
				<DropdownMenuPortal className="user-landing-dropdown-portal">
					<DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
						{loaderData.listTypes.filter(function(e) { return e.header !== selectedLatestUpdate.header }).map(listType =>
							<DropdownMenuItem className="user-landing-dropdown-item" onClick={() => {setSelectedLatestUpdate(listType)}}>
								{listType.header}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenuPortal>
			</DropdownMenu>
			<div className="user-landing-body-list-container">
				<div className="user-landing-body-item-container">
					{loaderData.typedEntries[selectedLatestUpdate.header].slice(0, 10).map(entry =>
					<div className="user-landing-body-item">
						<div className="user-landing-body-thumbnail-container">
							{hyperlinkRenderer(entry.thumbnail, "thumbnail")}
						</div>
						<div className="user-landing-body-text-container">
							<span className="user-landing-body-title">
								{entry.title}
							</span>
							<span className="user-landing-body-latest-type">
								{entry.history.mostRecent.type}
							</span>
							<span className="user-landing-body-latest-time">
								{`${timeSince(new Date(entry.history.mostRecent.time))} ago`}
							</span>
						</div>
					</div>
					)}
				</div>
			</div>
		</div>
	)
}

function FavoritesData() {
	const loaderData = useLoaderData()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	const typedFavorites = loaderData.favorites?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	const [selectedFavorite, setSelectedFavorite] = useState(loaderData.listTypes[0]);

	return (
		<div className="user-landing-favorites-container">
			<h1 className="user-landing-body-header">Favorites</h1>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<div className="user-landing-dropdown-trigger"> 
						{selectedFavorite.header}
					</div>
				</DropdownMenuTrigger>
				<DropdownMenuPortal className="user-landing-dropdown-portal">
					<DropdownMenuContent sideOffset={8} align="start" className="user-landing-dropdown-item-container">
						{loaderData.listTypes.filter(function(e) { return e.header !== selectedFavorite.header }).map(listType =>
							<DropdownMenuItem className="user-landing-dropdown-item" onClick={() => {setSelectedFavorite(listType)}}>
								{listType.header}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenuPortal>
			</DropdownMenu>
			{typedFavorites[selectedFavorite.id].slice(0, 10).map(entry =>
				<div className="user-landing-body-list-container">
					<h1 className="user-landing-body-header">{loaderData.listTypes?.find(listType => listType.id == selectedFavorite.header)}</h1>
					<div className="user-landing-body-item-container">
						<div className="user-landing-body-item">
							<div className="user-landing-body-thumbnail-container">
								{hyperlinkRenderer(entry.thumbnail, "thumbnail")}
							</div>
							<div className="user-landing-body-text-container">
								<span className="user-landing-body-title">
									{entry.title}
								</span>
								<span className="user-landing-body-media-type">
									{entry.mediaType}
								</span>
								<span className="user-landing-start-year">
									{new Date(entry.startYear).getFullYear()}
								</span>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

function BodyData() {
	const loaderData = useLoaderData()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	return (
		<div className="user-landing-body-container">
			{RecentActivityData()}
			{FavoritesData()}
		</div>
	)
}

export async function loader(params) {
	const user = await prisma.user.findFirst({
		select: {
			id: true,
			name: true,
			username: true,
			createdAt: true,
			image: { select: { id: true } },
		},
		where: {
			username: params.params['username'],
		},
	})

	invariantResponse(user, 'User not found', { status: 404 })

	const listTypes = await prisma.listType.findMany()

	const watchLists = await prisma.watchlist.findMany({
    where: {
      ownerId: user.id,
    },
  })

	const typedWatchlists = watchLists?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	let listEntries = []
	let typedEntries = {}

	for (const type of listTypes) {
		const typeFormatted = type.header.replace(/\W/g, '') + "Entry"
		let perWatchlistEntries = []

		for (const typedList of typedWatchlists[type.id]) {
			perWatchlistEntries.push(await prisma[typeFormatted].findMany({
				where: {
					watchlistId: typedList.id,
				},
			}))
		}

		typedEntries[type.header] = perWatchlistEntries.flat(2)
		
		for (const entry of typedEntries[type.header]) {
			if (entry.history && entry.history != null && entry.history != "null") {
				entry.history = JSON.parse(entry.history)

				let latestEntry = {
					type: null,
					time: new Date(0)
				}

				for (const [historyKey, historyValue] of Object.entries(entry.history)) {
					if (historyValue != null && historyValue != "null" && Object.entries(historyValue).length < 1) {
						let currentDate = new Date(historyValue)

						if (currentDate > latestEntry.time) {
							latestEntry = {
								type: historyKey.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
								time: currentDate
							}
						}
					}
				}

				entry.history.mostRecent = latestEntry
			}
			else {
				entry.history = {
					added: null,
					started: null,
					finished: null,
					progress: null,
					lastUpdated: null,
					mostRecent: {
						type: null,
						time: null
					}
				}
			}
		}

		typedEntries[type.header].sort(function(a, b) {
			if (!a.history.mostRecent.time || a.history.mostRecent.time == null)
				a.history.mostRecent.time = 0
			if (!b.history.mostRecent.time || b.history.mostRecent.time == null)
				b.history.mostRecent.time = 0

			if (a.history.mostRecent.time > b.history.mostRecent.time) return -1;
			if (a.history.mostRecent.time < b.history.mostRecent.time) return 1;
			return 0;
		});
}

	const favorites = await prisma.userFavorite.findMany({
    where: {
      ownerId: user.id,
    },
  })
	
	const favoritesSorted = favorites?.sort(function(a, b) {
		if (a.position < b.position) return -1;
		if (a.position > b.position) return 1;
		return 0;
	});

	return json({ user, userJoinedDisplay: user.createdAt.toLocaleDateString(), listTypes, watchLists, typedWatchlists, listEntries, typedEntries, favorites: favoritesSorted })
}

export default function ProfileRoute() {
	const loaderData = useLoaderData()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loaderData.user.id === loggedInUser?.id

	return (
		<main className="user-landing" style={{ width: '100%', height: '100%' }}>
			<div className="user-landing-main">
				{SideData()}
				{BodyData()}
			</div>
		</main>
	)
}

export const meta = ({ data, params }) => {
	const displayName = data?.user.name ?? params.params['username']
	return [
		{ title: `${displayName} | Epic Notes` },
		{
			name: 'description',
			content: `Profile of ${displayName} on Epic Notes`,
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No user with the username "{params.params['username']}" exists</p>
				),
			}}
		/>
	)
}
