import { invariantResponse } from '@epic-web/invariant'
import { json } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { BodyData } from '#app/routes/users+/$username_/body.jsx'
import { SideData } from '#app/routes/users+/$username_/side.jsx'
import { prisma } from '#app/utils/db.server.ts'
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

	return (
		<main className="user-landing" style={{ width: '100%', height: '100%' }}>
			<div className="user-landing-main">
				{SideData(loaderData)}
				{BodyData(loaderData)}
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
