import { invariantResponse } from '@epic-web/invariant'
import { json } from '@remix-run/node'
import { Form, Link, useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { timeSince, hyperlinkRenderer } from "#app/utils/lists/column-functions.tsx"
import { prisma } from '#app/utils/db.server.ts'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { useOptionalUser } from '#app/utils/user.ts'
import "#app/styles/user-landing.scss"

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

	const typedFavorites = loaderData.favorites?.reduce((x, y) => {
    (x[y.typeId] = x[y.typeId] || []).push(y);
     return x;
  },{});

	return (
		<main className="user-landing" style={{ width: '100%', height: '100%' }}>
			<div className="user-landing-main">
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
				<div className="user-landing-body-container">
					<div className="user-landing-recent-activity-container">
						<h1 className="user-landing-recent-activity-header">Recent Activity</h1>
						{Object.entries(loaderData.typedEntries)?.map(([listKey, listValue]) =>
							<div className="user-landing-recent-activity-list-container">
								<h1 className="user-landing-recent-activity-header">
									{`${listKey}`}
								</h1>
								<div className="user-landing-recent-activity-item-container">
									{listValue.slice(0, 10).map(entry =>
									<div className="user-landing-recent-activity-item">
										<div className="user-landing-recent-activity-thumbnail-container">
											{hyperlinkRenderer(entry.thumbnail, "thumbnail")}
										</div>
										<div className="user-landing-recent-activity-text-container">
											<span className="user-landing-recent-activity-title">
												{entry.title}
											</span>
											<span className="user-landing-recent-activity-latest-type">
												{entry.history.mostRecent.type}
											</span>
											<span className="user-landing-recent-activity-latest-time">
												{`${timeSince(new Date(entry.history.mostRecent.time))} ago`}
											</span>
										</div>
									</div>
									)}
								</div>
							</div>
						)}
					</div>
					<div className="user-landing-favorites-container">
						<h1 className="user-landing-favorites-header">Favorites</h1>
						{Object.entries(typedFavorites)?.map(([typeKey, typeValue]) =>
							<div className="user-landing-favorites-list-container">
								<h1 className="user-landing-favorites-header">{loaderData.listTypes?.find(listType => listType.id == typeKey).header}</h1>
								<div className="user-landing-favorites-item-container">
									{typeValue.map(favorite =>
									<div className="user-landing-favorites-item">
										<div className="user-landing-favorites-thumbnail-container">
											{hyperlinkRenderer(favorite.thumbnail, "thumbnail")}
										</div>
										<div className="user-landing-favorites-text-container">
											<span className="user-landing-favorites-title">
												{favorite.title}
											</span>
											<span className="user-landing-favorites-media-type">
												{favorite.mediaType}
											</span>
											<span className="user-landing-start-year">
												{new Date(favorite.startYear).getFullYear()}
											</span>
										</div>
									</div>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</main>
	)

	// return (
	// 	<div className="container mb-48 mt-36 flex flex-col items-center justify-center">
	// 		<Spacer size="4xs" />

	// 		<div className="container flex flex-col items-center rounded-3xl bg-muted p-12">
	// 			<div className="relative w-52">
	// 				<div className="absolute -top-40">
	// 					<div className="relative">
	// 						<img
	// 							src={getUserImgSrc(loaderData.user.image?.id)}
	// 							alt={userDisplayName}
	// 							className="h-52 w-52 rounded-full object-cover"
	// 						/>
	// 					</div>
	// 				</div>
	// 			</div>

	// 			<Spacer size="sm" />

	// 			<div className="flex flex-col items-center">
	// 				<div className="flex flex-wrap items-center justify-center gap-4">
	// 					<h1 className="text-center text-h2">{userDisplayName}</h1>
	// 				</div>
	// 				<p className="mt-2 text-center text-muted-foreground">
	// 					Joined {loaderData.userJoinedDisplay}
	// 				</p>
	// 				{isLoggedInUser ? (
	// 					<Form action="/logout" method="POST" className="mt-3">
	// 						<Button type="submit" variant="link" size="pill">
	// 							<Icon name="exit" className="scale-125 max-md:scale-150">
	// 								Logout
	// 							</Icon>
	// 						</Button>
	// 					</Form>
	// 				) : null}
	// 				<div className="mt-10 flex gap-4">
	// 					{isLoggedInUser ? (
	// 						<>
	// 							<Button asChild>
	// 								<Link to="../../lists" prefetch="intent">
	// 									My lists
	// 								</Link>
	// 							</Button>
	// 							<Button asChild>
	// 								<Link to="notes" prefetch="intent">
	// 									My notes
	// 								</Link>
	// 							</Button>
	// 							<Button asChild>
	// 								<Link to="/settings/profile" prefetch="intent">
	// 									Edit profile
	// 								</Link>
	// 							</Button>
	// 						</>
	// 					) : (
	// 						<Button asChild>
	// 							<Link to="notes" prefetch="intent">
	// 								{userDisplayName}'s notes
	// 							</Link>
	// 						</Button>
	// 					)}
	// 				</div>
	// 			</div>
	// 		</div>
	// 	</div>
	// )
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
