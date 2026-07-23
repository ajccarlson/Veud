import { useEffect, useState } from 'react'
import {
	getSortableWatchlistColumns,
	getWatchlistDefaultSortModel,
} from '#app/utils/lists/default-sort.ts'
import {
	getSiteIdSafe,
	getThumbnailInfo,
} from '#app/utils/lists/column-functions.tsx'
import {
	setColumnParams,
	type FavoriteSummary,
	type WatchlistColumnParams,
	type WatchlistViewProps,
} from './grid-state.ts'

const EMPTY_FAVORITES: FavoriteSummary[] = []

export function useWatchlistState(props: WatchlistViewProps) {
	const [localListEntries, setLocalListEntries] = useState(() => [
		...props.listEntries,
	])
	const listEntries = props.setListEntries
		? props.listEntries
		: localListEntries
	const setListEntries = props.setListEntries ?? setLocalListEntries
	const [selectedSearchType, setSelectedSearchType] = useState('Type')
	const favorites =
		props.typedFavorites[props.listTypeData.id] ?? EMPTY_FAVORITES
	const [favoriteIds, setFavoriteIds] = useState(() =>
		favorites.map(favorite => {
			return getSiteIdSafe(getThumbnailInfo(favorite.thumbnail).url)?.id
		}),
	)

	useEffect(() => {
		if (!props.setListEntries) setLocalListEntries([...props.listEntries])
	}, [props.listEntries, props.setListEntries])

	useEffect(() => {
		setFavoriteIds(
			favorites.map(favorite => {
				return getSiteIdSafe(getThumbnailInfo(favorite.thumbnail).url)?.id
			}),
		)
	}, [favorites])

	const displayedColumns = (props.watchListData.displayedColumns ?? '')
		.split(', ')
		.filter(Boolean)
		.reduce<Record<string, boolean>>((columns, value) => {
			columns[value] = true
			return columns
		}, {})
	const sortableColumns = getSortableWatchlistColumns(
		props.listTypeData.columns,
	)
	const defaultSortModel = getWatchlistDefaultSortModel(
		props.watchListData,
		sortableColumns,
	)
	const columnParams: WatchlistColumnParams = {
		listEntries,
		setListEntries,
		selectedSearchType,
		setSelectedSearchType,
		favoriteIds,
		setFavoriteIds,
		watchListData: props.watchListData,
		listTypeData: props.listTypeData,
		watchlistId: props.watchlistId,
		typedWatchlists: props.typedWatchlists,
		typedFavorites: props.typedFavorites,
		trackingByIdentity: props.trackingByIdentity,
		listOwner: props.listOwner,
		currentUser: props.currentUser,
		currentUserId: props.currentUserId,
		displayedColumns,
		navigate: props.navigate,
	}
	setColumnParams(columnParams)

	return {
		columnParams,
		defaultSort: defaultSortModel[0],
		defaultSortModel,
		listEntries,
		sortableColumns,
	}
}
