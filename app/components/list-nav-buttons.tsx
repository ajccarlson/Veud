import { type ListType, type Watchlist } from '@prisma/client'
import { Link } from 'react-router'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import '#app/styles/list-nav-buttons.scss'

type WatchlistNavItem = Pick<
	Watchlist,
	'id' | 'name' | 'header' | 'position' | 'typeId' | 'isPublic'
>
type ListTypeNavItem = Pick<ListType, 'id' | 'name' | 'header'>

export function listNavButtons(
	typedWatchlists: Record<string, WatchlistNavItem[]>,
	username: string,
	listTypes: ListTypeNavItem[],
	listTypeData: ListTypeNavItem,
	watchListData: Pick<WatchlistNavItem, 'id'>,
) {
	const watchlists = typedWatchlists[listTypeData.id] ?? []
	const hasOtherListTypes = Object.keys(typedWatchlists).length > 1

	return (
		<nav className="list-nav-buttons" aria-label="Watchlists and media types">
			<div className="list-nav-buttons-main" id="list-nav">
				<div className="list-nav-list-scroller">
					<div className="list-nav-buttons-container">
						{watchlists.map(list => (
							<Link
								key={list.id}
								prefetch="intent"
								to={`/lists/${username}/${listTypeData.name}/${list.name}`}
								className={`list-nav-button ${watchListData.id === list.id ? 'list-nav-current' : ''}`}
								id={list.id}
								data-watchlist-id={list.id}
								data-watchlist-name={list.name}
								data-watchlist-header={list.header}
								aria-current={watchListData.id === list.id ? 'page' : undefined}
							>
								<span>{list.header}</span>
								{!list.isPublic ? (
									<span className="list-nav-private-badge">Private</span>
								) : null}
							</Link>
						))}
					</div>
				</div>
				{hasOtherListTypes ? (
					<div className="list-type-nav-container" id="list-type-nav">
						<div className="list-type-dropdown-container">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										className="list-type-dropdown-trigger"
										aria-label={`Change media type. Current type: ${listTypeData.header}`}
									>
										<span className="list-type-dropdown-icon">
											<Icon name="hamburger-menu" aria-hidden="true" />
										</span>
										<span>{listTypeData.header}</span>
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent sideOffset={8} align="start">
									{Object.entries(typedWatchlists)
										.filter(([typeId]) => typeId !== listTypeData.id)
										.map(([typeId, lists]) => {
											const targetType = listTypes.find(
												listType => listType.id === typeId,
											)
											const firstList = [...lists].sort(
												(first, second) => first.position - second.position,
											)[0]
											if (!targetType || !firstList) return null
											return (
												<DropdownMenuItem key={typeId} asChild>
													<Link
														prefetch="intent"
														to={`/lists/${username}/${targetType.name}/${firstList.name}`}
														className="list-type-dropdown-button"
													>
														{targetType.header}
													</Link>
												</DropdownMenuItem>
											)
										})}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				) : null}
			</div>
		</nav>
	)
}
