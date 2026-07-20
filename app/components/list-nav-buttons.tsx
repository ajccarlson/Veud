import { Link } from 'react-router'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import '#app/styles/list-nav-buttons.scss'

export function listNavButtons(
	typedWatchlists: any,
	username: any,
	listTypes: any,
	listTypeData: any,
	watchListData: any,
) {
	const watchlists = typedWatchlists[listTypeData.id] ?? []
	const hasOtherListTypes = Object.keys(typedWatchlists).length > 1

	return (
		<main className="list-nav-buttons">
			<div className="list-nav-buttons-main" id="list-nav">
				<div className="list-nav-buttons-container">
					{watchlists.map((list: any) => (
						<Link
							key={list.id}
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
				{hasOtherListTypes ? (
					<div className="list-type-nav-container" id="list-type-nav">
						<div className="list-type-dropdown-container">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button type="button" className="list-type-dropdown-trigger">
										<span className="list-type-dropdown-icon">
											<Icon name="hamburger-menu" aria-hidden="true" />
										</span>
										<span>{listTypeData.header}</span>
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent sideOffset={8} align="start">
									{Object.entries(typedWatchlists)
										.filter(([typeId]) => typeId !== listTypeData.id)
										.map(([typeId, lists]: [string, any]) => {
											const targetType = listTypes.find(
												(listType: any) => listType.id === typeId,
											)
											const firstList = lists.reduce(
												(previous: any, current: any) =>
													previous.position < current.position
														? previous
														: current,
											)
											return (
												<DropdownMenuItem key={typeId} asChild>
													<Link
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
		</main>
	)
}
