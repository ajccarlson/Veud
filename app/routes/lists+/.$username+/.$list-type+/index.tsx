import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useNavigation,
} from 'react-router'
import { useOptionalUser } from '#app/utils/user.ts'
import { Link } from 'react-router'
import { useState, useEffect } from 'react'
import { prisma } from '#app/utils/db.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { visibleWatchlistWhere } from '#app/utils/lists/visibility.server.ts'
import { mutateList } from '#app/utils/lists/mutation-client.ts'
import {
	timeSince,
	getStartYear,
	getThumbnailInfo,
} from '#app/utils/lists/column-functions.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { invariantResponse } from '@epic-web/invariant'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { GetWatchlistSettings } from '#app/routes/lists+/.$username+/.$list-type+/_settings.tsx'
import '#app/styles/list-landing.scss'

async function createNewList(listParams: any) {
	const typeId = listParams.listTypeData.id

	let lastPosition = 1
	if (listParams && listParams.sameType.length > 0) {
		lastPosition = listParams.sameType.slice(-1)[0].watchlist.position + 1
	}

	const addData = await mutateList<'create-watchlist', any>(
		'create-watchlist',
		{
			position: lastPosition,
			name: ' ',
			header: ' ',
			typeId,
			displayedColumns: Object.keys(
				JSON.parse(listParams.listTypeData.columns) as Record<string, unknown>,
			)
				.filter(
					entry =>
						entry !== 'id' && entry !== 'watchlistId' && entry !== 'watchlist',
				)
				.join(', '),
			description: ' ',
		},
	)

	listParams.setWatchListData((current: any[]) => [
		...current,
		{
			watchlist: addData,
			listEntries: [],
		},
	])

	listParams.setShownSettings([...listParams.shownSettings, addData.id])
}

function getWatchlistNav(entryData: any, listParams: any) {
	const titleId = `list-card-${entryData.watchlist.id}`

	return (
		<article
			key={entryData.watchlist.id}
			className="list-landing-nav-item-container"
			aria-labelledby={titleId}
		>
			<div className="list-landing-nav-top">
				<div className="list-landing-nav-title">
					<h2 id={titleId} className="list-landing-nav-header">
						{entryData.watchlist.header}
					</h2>
					{!entryData.watchlist.isPublic ? (
						<span className="list-visibility-badge">Private</span>
					) : null}
				</div>
				<div className="list-landing-nav-length">
					{entryData.listEntries.length}
				</div>
			</div>
			<div className="list-landing-nav-bottom-container">
				<div className="list-landing-nav-bottom">
					<div>
						<p className="list-landing-nav-description">
							{entryData.watchlist.description}
						</p>
						{entryData.listEntries ? (
							<div className="list-landing-nav-entry-preview-container">
								{entryData.watchlist.description.length > 30 ? (
									<hr className="list-landing-nav-entry-preview-separator"></hr>
								) : null}
								<div className="list-landing-nav-thumbnail-container">
									{entryData.listEntries.slice(0, 5).map((listEntry: any) => (
										<div
											key={listEntry.id}
											className="list-landing-nav-thumbnail-item"
										>
											<Link
												to={getThumbnailInfo(listEntry.thumbnail).url}
												className="list-landing-body-thumbnail-image"
												style={{
													backgroundImage: `url("${getThumbnailInfo(listEntry.thumbnail).content}")`,
												}}
											>
												<span className="list-landing-thumbnail-header">
													<div className="list-landing-thumbnail-start-year">
														{getStartYear(
															listEntry,
															listParams.listTypeData,
															listParams.listTypes,
														)}
													</div>
													<div className="list-landing-thumbnail-media-type">
														{listEntry.type}
													</div>
												</span>
												<span className="list-landing-thumbnail-footer">
													{listEntry.title.length > 20
														? `${listEntry.title.substring(0, 20)}...`
														: listEntry.title}
												</span>
											</Link>
										</div>
									))}
								</div>
							</div>
						) : null}
						<div className="list-landing-nav-last-updated-container">
							Last Updated:
							<span className="list-landing-nav-last-updated-span">
								{`${timeSince(new Date(entryData.watchlist.updatedAt))} ago`}
							</span>
						</div>
					</div>
				</div>
			</div>
			{listParams.currentUserId == listParams.listOwner.id ? (
				<div className="list-landing-nav-link-container">
					<Link
						to={`/lists/${listParams.username}/${listParams.listTypeData.name}/${entryData.watchlist.name}`}
						className="list-landing-nav-link-item"
						aria-label={`Open ${entryData.watchlist.header} list`}
					>
						Open
					</Link>
					<button
						type="button"
						className="list-landing-nav-link-end"
						aria-label={`Edit ${entryData.watchlist.header} list settings`}
						onClick={() => {
							listParams.setShownSettings([
								...listParams.shownSettings,
								entryData.watchlist.id,
							])
						}}
					>
						Settings
					</button>
				</div>
			) : (
				<div className="list-landing-nav-link-container">
					<Link
						to={`/lists/${listParams.username}/${listParams.listTypeData.name}/${entryData.watchlist.name}`}
						className="list-landing-nav-link-end"
						aria-label={`Open ${entryData.watchlist.header} list`}
					>
						Open
					</Link>
				</div>
			)}
		</article>
	)
}

export function listNavigationDisplayer(listParams: any) {
	let navigationItems: any[] = []

	for (const entryData of listParams.watchListData) {
		if (listParams.shownSettings.includes(entryData.watchlist.id)) {
			navigationItems.push(GetWatchlistSettings(entryData, listParams))
		} else {
			navigationItems.push(getWatchlistNav(entryData, listParams))
		}
	}

	return navigationItems
}

export async function loader(params: LoaderFunctionArgs) {
	const [viewerId, listOwner, listTypes] = await Promise.all([
		getUserId(params.request),
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
	invariantResponse(listTypeData, 'List type not found', { status: 404 })

	const watchLists = await prisma.watchlist.findMany({
		where: {
			typeId: listTypeData.id,
			ownerId: listOwner.id,
			AND: [visibleWatchlistWhere(viewerId)],
		},
	})

	let watchListData: any[] = []
	let watchListNavs: any[] = []
	let watchListSettings: any[] = []

	const watchListsSorted = watchLists.sort((a, b) => a.position - b.position)

	// One batched query for all entries across these watchlists, grouped in memory — instead
	// of a query per watchlist (N+1).
	const allEntries = watchListsSorted.length
		? await prisma.entry.findMany({
				where: { watchlistId: { in: watchListsSorted.map(w => w.id) } },
			})
		: []
	const entriesByWatchlist = new Map<string, any[]>()
	for (const entry of allEntries) {
		const arr = entriesByWatchlist.get(entry.watchlistId) ?? []
		arr.push(entry)
		entriesByWatchlist.set(entry.watchlistId, arr)
	}

	for (const watchlist of watchListsSorted) {
		const listEntries = entriesByWatchlist.get(watchlist.id) ?? []

		const entryData = {
			watchlist: watchlist,
			listEntries: listEntries.sort(
				(a: any, b: any) => a.position - b.position,
			),
		}

		watchListData.push(entryData)
	}

	if (watchListNavs.length < 1) {
		watchListNavs = [`<h1">No lists found</h1>`]
	}
	return json({
		watchListData,
		watchListNavs,
		watchListSettings,
		listOwner,
		username: params['params']['username'],
		listTypes,
		listTypeData,
	})
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No list type with the the name "{params.listType}" exists</p>
				),
			}}
		/>
	)
}

export default function Lists() {
	const [shownSettings, setShownSettings] = useState<any[]>([])
	const [settingsErrors, setSettingsErrors] = useState<any[]>([])
	const loaderData = useLoaderData<typeof loader>()
	const [watchListData, setWatchListData] = useState<any[]>(
		() => loaderData.watchListData,
	)
	const navigation = useNavigation()
	const currentUser = useOptionalUser()
	const currentUserId = currentUser ? currentUser.id : null

	useEffect(() => {
		setWatchListData(loaderData.watchListData)
		setShownSettings([])
		setSettingsErrors([])
	}, [loaderData.listTypeData.id, loaderData.watchListData])

	const sameType = watchListData.filter(
		(item: any) => item.watchlist.typeId === loaderData.listTypeData.id,
	)
	const listParams = {
		watchListData,
		setWatchListData,
		sameType,
		listOwner: loaderData.listOwner,
		username: loaderData.username,
		currentUser,
		currentUserId,
		listTypes: loaderData.listTypes,
		listTypeData: loaderData.listTypeData,
		shownSettings,
		setShownSettings,
		settingsErrors,
		setSettingsErrors,
	}
	const navItems = listNavigationDisplayer(listParams)

	let firstListMessage: string | undefined
	if (!sameType || sameType.length < 1) {
		if (listParams.currentUserId == listParams.listOwner.id) {
			firstListMessage = 'Create your first list'
		} else {
			firstListMessage = 'User has no lists'
		}
	}

	return (
		<main className="list-landing" aria-busy={navigation.state !== 'idle'}>
			<div className="list-landing-nav-main">
				<div className="list-landing-nav-container">
					<header className="list-landing-page-header">
						<div>
							<p className="list-landing-page-eyebrow">
								{loaderData.username}'s library
							</p>
							<h1>{loaderData.listTypeData.header} lists</h1>
						</div>
						<p>
							{sameType.length} {sameType.length === 1 ? 'list' : 'lists'}
							{navigation.state !== 'idle' ? (
								<span className="list-landing-loading">Updating…</span>
							) : null}
						</p>
					</header>
					{navItems}
					{firstListMessage ? (
						<div className="list-landing-starting-message">
							{firstListMessage}
						</div>
					) : null}
					{listParams.currentUserId == listParams.listOwner.id ? (
						<button
							type="button"
							className="list-landing-nav-insert"
							onClick={() => {
								createNewList(listParams)
							}}
						>
							<Icon name="plus" aria-hidden="true" />
							Create list
						</button>
					) : null}
				</div>
			</div>
			<nav
				className="list-landing-sidebar-container"
				aria-label="Media list types"
			>
				<Link
					prefetch="intent"
					to={`/lists/${loaderData.username}/liveaction`}
					className={`list-landing-sidebar-item ${listParams.listTypeData.name == 'liveaction' ? 'list-landing-sidebar-item-current' : ''}`}
				>
					Live Action
				</Link>
				<Link
					prefetch="intent"
					to={`/lists/${loaderData.username}/anime`}
					className={`list-landing-sidebar-item ${listParams.listTypeData.name == 'anime' ? 'list-landing-sidebar-item-current' : ''}`}
				>
					Anime
				</Link>
				<Link
					prefetch="intent"
					to={`/lists/${loaderData.username}/manga`}
					className={`list-landing-sidebar-item list-landing-sidebar-item-bottom ${listParams.listTypeData.name == 'manga' ? 'list-landing-sidebar-item-current' : ''}`}
				>
					Manga
				</Link>
			</nav>
		</main>
	)
}
