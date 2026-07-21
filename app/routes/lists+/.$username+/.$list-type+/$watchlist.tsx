import { invariantResponse } from '@epic-web/invariant'
import { data as json, type LoaderFunctionArgs } from 'react-router'
import { useLoaderData, useNavigate } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from '#app/components/list-nav-buttons.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { mediaIdentityKey } from '#app/utils/media-identity.ts'
import { watchlistGrid } from '#app/routes/lists+/.$username+/.$list-type+/grid/watchlist-grid.tsx'
import { visibleWatchlistWhere } from '#app/utils/lists/visibility.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import '#app/styles/watchlist.scss'

export async function loader(params: LoaderFunctionArgs) {
	const viewerId = await getUserId(params.request)
	const [listOwner, listTypes] = await Promise.all([
		prisma.user.findUnique({
			where: {
				username: params['params']['username']!,
			},
		}),
		prisma.listType.findMany(),
	])

	invariantResponse(listOwner, 'User not found', { status: 404 })

	const listType = params['params']['list-type']
	const listTypeData = listTypes.find(type => type.name === listType)
	// Guard before reading `.header`/`.id`: the original accessed these before its 404
	// check, so a missing list type would have thrown a 500 instead of the intended 404.
	invariantResponse(listTypeData, 'List type not found', { status: 404 })

	const watchLists = await prisma.watchlist.findMany({
		where: {
			ownerId: listOwner.id,
			AND: [visibleWatchlistWhere(viewerId)],
		},
	})

	let watchListData

	const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)

	for (const watchList of watchLists) {
		if (watchList.typeId == listTypeData.id) {
			if (watchList.name == params['params']['watchlist']) {
				watchListData = watchList
				break
			}
		}
	}

	// Narrowing via the entity itself (equivalent to the old `listFound` flag) tells the
	// type-checker `watchListData` is defined below.
	invariantResponse(watchListData, 'Watchlist not found', { status: 404 })

	const typedWatchlists = watchLists.reduce<Record<string, typeof watchLists>>(
		(x, y) => {
			;(x[y.typeId] = x[y.typeId] || []).push(y)
			return x
		},
		{},
	)

	const [listEntries, favorites, trackingStates] = await Promise.all([
		prisma.entry.findMany({
			where: {
				watchlistId: watchListData.id,
			},
			include: {
				media: { select: { kind: true } },
				trackingState: {
					select: {
						status: true,
						statusWatchlistId: true,
						score: true,
						startedAt: true,
						completedAt: true,
						repeatCount: true,
						progress: {
							select: { unit: true, current: true, total: true },
						},
					},
				},
			},
		}),
		prisma.userFavorite.findMany({
			where: {
				ownerId: listOwner.id,
			},
		}),
		viewerId === listOwner.id
			? prisma.trackingState.findMany({
					where: { ownerId: viewerId },
					select: {
						mediaId: true,
						statusWatchlistId: true,
						statusWatchlist: { select: { header: true } },
						media: {
							select: {
								externalIds: {
									select: {
										provider: true,
										kind: true,
										externalId: true,
									},
								},
							},
						},
					},
				})
			: Promise.resolve([]),
	])

	const listEntriesSorted = listEntries.sort(
		(a: any, b: any) => a.position - b.position,
	)

	const typedFavorites = favorites.reduce<Record<string, typeof favorites>>(
		(x, y) => {
			;(x[y.typeId] = x[y.typeId] || []).push(y)
			return x
		},
		{},
	)
	const trackingByIdentity = Object.fromEntries(
		trackingStates.flatMap(tracking =>
			tracking.media.externalIds.map(identity => [
				mediaIdentityKey(identity as any),
				{
					mediaId: tracking.mediaId,
					watchlistId: tracking.statusWatchlistId,
					statusLabel: tracking.statusWatchlist?.header ?? null,
				},
			]),
		),
	)

	return json({
		watchList: params['params']['watchlist'],
		username: params['params']['username'],
		listType: params['params']['list-type'],
		listTypes,
		listTypeData,
		listEntries: listEntriesSorted,
		watchLists,
		watchListsSorted,
		typedWatchlists,
		watchListData,
		watchlistId: watchListData.id,
		typedFavorites,
		trackingByIdentity,
		listOwner,
	})
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No watchlist with the the name "{params.watchlist}" exists</p>
				),
			}}
		/>
	)
}

export default function WatchList() {
	const currentUser = useOptionalUser()
	const currentUserId = currentUser ? currentUser.id : null
	const loaderData = useLoaderData<typeof loader>()
	const navigate = useNavigate()

	return (
		<main className="user-watchlist">
			{watchlistGrid(
				loaderData.listEntries,
				loaderData.watchListData,
				loaderData.listTypeData,
				loaderData.watchlistId,
				loaderData.typedWatchlists,
				loaderData.typedFavorites,
				loaderData.trackingByIdentity,
				loaderData.listOwner,
				currentUser,
				currentUserId,
				(loaderData as any).VEUD_API_KEY,
				navigate,
			)}
			{listNavButtons(
				loaderData.typedWatchlists,
				loaderData.username,
				loaderData.listTypes,
				loaderData.listTypeData,
				loaderData.watchListData,
			)}
		</main>
	)
}
