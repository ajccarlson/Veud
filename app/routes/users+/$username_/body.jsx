import { useState } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { timeSince, hyperlinkRenderer } from "#app/utils/lists/column-functions.tsx"
import { useOptionalUser } from '#app/utils/user.ts'

function RecentActivityData(loaderData) {
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

function FavoritesData(loaderData) {
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

export function BodyData(loaderData) {
	return (
		<div className="user-landing-body-container">
			{RecentActivityData(loaderData)}
			{FavoritesData(loaderData)}
		</div>
	)
}
