import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useNavigate,
	useRevalidator,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { listNavButtons } from '#app/components/list-nav-buttons.tsx'
import { TrackingAssistantDialog } from '#app/components/tracking-assistant-dialog.tsx'
import { ResponsiveWatchlist } from '#app/routes/lists+/.$username+/.$list-type+/grid/responsive-watchlist.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	canonicalizeLinkedWatchlistEntry,
	prepareWatchlistEntryForViewer,
	publicEntryPayload,
	publicListOwnerSelect,
	publicListTypeSelect,
	publicWatchlistSelect,
} from '#app/utils/lists/public-watchlist.server.ts'
import { visibleWatchlistWhere } from '#app/utils/lists/visibility.server.ts'
import { normalizeWatchlistEntryScores } from '#app/utils/lists/watchlist-entry-scores.server.ts'
import { mediaCatalogSelect } from '#app/utils/media-catalog.ts'
import { mediaIdentityKey } from '#app/utils/media-identity.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import '#app/styles/watchlist.scss'

export async function loader(params: LoaderFunctionArgs) {
	const viewerId = await getUserId(params.request)
	const [listOwner, listTypes] = await Promise.all([
		prisma.user.findUnique({
			where: {
				username: params['params']['username']!,
			},
			select: publicListOwnerSelect,
		}),
		prisma.listType.findMany({
			select: publicListTypeSelect,
		}),
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
		select: publicWatchlistSelect,
	})

	let watchListData

	watchLists.sort((a, b) => a.position - b.position)

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
				media: {
					select: {
						kind: true,
						...mediaCatalogSelect,
						externalIds: {
							orderBy: { provider: 'asc' },
							select: {
								provider: true,
								kind: true,
								externalId: true,
							},
						},
					},
				},
				trackingState: {
					select: {
						ownerId: true,
						mediaId: true,
						status: true,
						statusWatchlistId: true,
						score: true,
						startedAt: true,
						completedAt: true,
						repeatCount: true,
						progress: {
							where: {
								unit: { in: ['episode', 'chapter', 'volume'] },
							},
							orderBy: { unit: 'asc' },
							take: 3,
							select: { unit: true, current: true, total: true },
						},
						statusWatchlist: { select: { ownerId: true, isPublic: true } },
					},
				},
			},
		}),
		viewerId === listOwner.id
			? prisma.userFavorite.findMany({
					where: { ownerId: listOwner.id },
					select: {
						id: true,
						typeId: true,
						thumbnail: true,
						media: { select: { thumbnail: true } },
					},
				})
			: Promise.resolve([]),
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

	const isOwner = viewerId === listOwner.id
	const normalizedEntries = listEntries
		.map(entry => prepareWatchlistEntryForViewer(entry, listOwner.id, isOwner))
		.map(canonicalizeLinkedWatchlistEntry)
		.map(normalizeWatchlistEntryScores)
		.sort((a, b) => a.position - b.position)
	const listEntriesSorted = isOwner
		? normalizedEntries
		: normalizedEntries.map(entry =>
				publicEntryPayload(entry, watchListData.displayedColumns),
			)

	const browserFavorites = favorites.map(favorite => ({
		id: favorite.id,
		typeId: favorite.typeId,
		thumbnail: favorite.media?.thumbnail ?? favorite.thumbnail,
	}))
	const typedFavorites = browserFavorites.reduce<
		Record<string, typeof browserFavorites>
	>((x, y) => {
		;(x[y.typeId] = x[y.typeId] || []).push(y)
		return x
	}, {})
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
		username: listOwner.username,
		listType: params['params']['list-type'],
		listTypes,
		listTypeData,
		listEntries: listEntriesSorted,
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
	const revalidator = useRevalidator()

	return (
		<main className="user-watchlist">
			<h1 className="sr-only">
				{loaderData.watchListData.header} · {loaderData.listTypeData.header}{' '}
				list for {loaderData.listOwner.username}
			</h1>
			<header className="watchlist-context-bar">
				<div>
					<span>{loaderData.listTypeData.header}</span>
					<strong>{loaderData.watchListData.header}</strong>
				</div>
				{currentUserId === loaderData.listOwner.id ? (
					<TrackingAssistantDialog
						watchlistLabel={loaderData.watchListData.header}
						onLibraryChanged={() => revalidator.revalidate()}
					/>
				) : null}
			</header>
			<ResponsiveWatchlist
				listEntries={loaderData.listEntries}
				watchListData={loaderData.watchListData}
				listTypeData={loaderData.listTypeData}
				watchlistId={loaderData.watchlistId}
				typedWatchlists={loaderData.typedWatchlists}
				typedFavorites={loaderData.typedFavorites}
				trackingByIdentity={loaderData.trackingByIdentity}
				listOwner={loaderData.listOwner}
				currentUser={currentUser}
				currentUserId={currentUserId}
				navigate={navigate}
			/>
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
