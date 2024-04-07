import { Form, useSearchParams, useSubmit } from '@remix-run/react'
import { useId } from 'react'
import { useState } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { searchTMDB, getTMDBInfo } from "#app/routes/media+/tmdb.jsx"
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'
import "#app/styles/watchlist-search.scss"
import { refreshGrid } from '#app/routes/lists+/.$username+/.$list-type+/$watchlist_grid.jsx'

export function MediaSearchBar(params) {
	const id = useId()
	const [searchParams] = useSearchParams()
	const [mediaResults, setmediaResults] = useState([]);

	console.log(params)

	return (
		<Form
			method="GET"
			onSubmit={async (event) => {
        event.preventDefault();
				setmediaResults(await searchTMDB(event.target.search.value, "multi"))
      }}
			className="watchlist-search flex flex-wrap items-center justify-center gap-2"
		>
			<div className="flex-1">
				<Input
					type="search"
					name="search"
					id={id}
					defaultValue={searchParams.get('search') ?? ''}
					placeholder="Search"
					autocomplete="off"
					className="w-full"
				/>
			</div>
			<div>
				<StatusButton
					type="submit"
					className="flex w-full items-center justify-center"
				>
					<Icon name="magnifying-glass" size="md" />
				</StatusButton>
			</div>
			<div>
				{mediaResults.map( result =>
					<div className="watchlist-search-item" onClick={async () => {
						const resultInfo = await getTMDBInfo(result.title, "multi")

						const addRow = {/*id: " ", */watchlistId: params.params.params.data.watchlistId, position: params.params.params.data.position + 1, thumbnail: resultInfo.thumbnail, title: resultInfo.title, type: resultInfo.type, airYear: String(resultInfo.year), length: resultInfo.length, rating: resultInfo.rating, finishedDate: new Date(0), genres: resultInfo.genres , language: resultInfo.language, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: resultInfo.score, differenceObjective: 0, description: resultInfo.description}

						const addResponse = await fetch('/lists/fetch/add-row/' + new URLSearchParams({
							listType: params.params.listType,
						  row: JSON.stringify(addRow)
						}))

						const updateResponse = await fetch('/lists/fetch/now-updated/' + new URLSearchParams({
							watchlistId: params.params.params.data.watchlistId
						}))

						refreshGrid();
					}}>
						{result.title}
					</div>
				)}
			</div>
		</Form>
	)
}

export function MediaTypeDropdown() {
	const [selectedItem, setSelectedItem] = useState("Type");

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
