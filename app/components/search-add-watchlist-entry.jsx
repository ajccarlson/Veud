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
import { searchTMDB } from "#app/routes/media+/tmdb.jsx"
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'
import "#app/styles/watchlist-search.scss"

export function MediaSearchBar() {
	const id = useId()
	const [searchParams] = useSearchParams()
	const [mediaResults, setmediaResults] = useState([]);

	return (
		<Form
			method="GET"
			onSubmit={async (event) => {
        event.preventDefault();
				setmediaResults(await searchTMDB(event.target.search.value, "movie"))
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
					<div className="watchlist-search-item">
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
