import { Form, useSearchParams } from '@remix-run/react'
import { useId, useState } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { searchTMDB, getTMDBInfo } from "#app/routes/media+/tmdb.jsx"
import { Icon } from './ui/icon.tsx'
import { StatusButton } from './ui/status-button.tsx'
import "#app/styles/watchlist-search.scss"
import { refreshGrid } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist_grid.jsx'

function MediaValues() {
	const [selectedItem, setSelectedItem] = useState("Type");
	return {selectedItem, setSelectedItem}
}

export function MediaSearchBar(params) {
	const id = useId()
	const [searchParams] = useSearchParams()
	const [mediaResults, setmediaResults] = useState([]);
	const {selectedItem, setSelectedItem} = MediaValues();
	const [showDropdown, setShowDropdown] = useState(true);

	// console.log(params)

	return (
		<Form
			method="GET"
			onSubmit={async (event) => {
        event.preventDefault();
				setmediaResults(await searchTMDB(event.target.search.value, selectedItem))
      }}
			className="watchlist-search flex flex-wrap items-center justify-center"
		>
			{ showDropdown ? 
				<div>
					<div className="flex flex-row gap-2">
						<input
							type="search"
							name="search"
							id={id}
							defaultValue={searchParams.get('search') ?? ''}
							placeholder="Search"
							autoComplete="off"
							className="w-full"
						/>
						<StatusButton
							type="submit"
						>
							<Icon name="magnifying-glass" size="md" />
						</StatusButton>
					</div>
					{mediaResults.map( result =>
						<div className="watchlist-search-item" onClick={async () => {
							setShowDropdown(false)

							const resultInfo = await getTMDBInfo(result.title, selectedItem)

							const addRow = {/*id: " ", */watchlistId: params.params.params.data.watchlistId, position: params.params.params.data.position, thumbnail: resultInfo.thumbnail, title: resultInfo.title, type: resultInfo.type, airYear: String(resultInfo.year), length: resultInfo.length, rating: resultInfo.rating, finishedDate: new Date(0), genres: resultInfo.genres , language: resultInfo.language, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: resultInfo.score, differenceObjective: 0, description: resultInfo.description}

							const addResponse = await fetch('/lists/fetch/add-row/' + new URLSearchParams({
								listType: params.params.listType,
								row: JSON.stringify(addRow)
							}))

							const deleteEmptyResponse = await fetch('/lists/fetch/delete-empty-rows/' + new URLSearchParams({
								listName: params.params.watchlistName,
								listType: params.params.listType,
							}))
							const deleteEmptyData = await deleteEmptyResponse.json();
							console.log(deleteEmptyData)

							const updateResponse = await fetch('/lists/fetch/now-updated/' + new URLSearchParams({
								watchlistId: params.params.params.data.watchlistId
							}))

							refreshGrid(undefined, {watchlistName: params.params.watchlistName, listType: params.params.listType, watchlistId: params.params.params.data.watchlistId});
							setShowDropdown(true)
						}}>
							{result.title}
						</div>
					)}
				</div>
			:
			<div role="status">
				<svg aria-hidden="true" class="inline w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-[#FF9900]" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
						<path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
				</svg>
				<span class="sr-only">Loading...</span>
			</div>
		}
		</Form>
	)
}

export function MediaTypeDropdown() {
	const {selectedItem, setSelectedItem} = MediaValues();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<div className="bg-[#6F6F6F] hover:bg-[#8CA99D] cursor-pointer text-base font-bold py-[0.1rem] px-[0.5rem] rounded"> 
					{selectedItem}
				</div>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuContent sideOffset={8} align="start">
					<DropdownMenuItem onClick={() => {setSelectedItem('Movie')}}>
						Movie
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => {setSelectedItem('TV Series')}}>
						TV Series
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	)
}
