import { Form } from 'react-router'
import { timeSince } from '#app/utils/lists/column-functions.tsx'
import {
	getSortableWatchlistColumns,
	watchlistColumnLabel,
} from '#app/utils/lists/default-sort.ts'
import { Icon } from '#app/components/ui/icon.tsx'
import { Spacer } from '#app/components/spacer.tsx'

function checkDisplayedColumns(columns: string[], displayedColumns: string[]) {
	let checkedColumns: any[] = []
	let displayedIndex = 0

	for (let column of columns) {
		if (column == 'id' || column == 'watchlistId' || column == 'watchlist')
			continue

		if (displayedColumns[displayedIndex]) {
			if (column == displayedColumns[displayedIndex]) {
				checkedColumns.push(
					<label key={column} className="list-landing-settings-checkbox-item">
						<input
							id={`${column}-checkbox`}
							name={`${column}-checkbox`}
							type="checkbox"
							defaultChecked={true}
						/>
						{(column.charAt(0).toUpperCase() + column.substr(1))
							.split(/(?=[A-Z])/)
							.join(' ')}
					</label>,
				)

				displayedIndex++
			} else {
				checkedColumns.push(
					<label key={column} className="list-landing-settings-checkbox-item">
						<input
							type="checkbox"
							id={`${column}-checkbox`}
							name={`${column}-checkbox`}
						/>
						{(column.charAt(0).toUpperCase() + column.substr(1))
							.split(/(?=[A-Z])/)
							.join(' ')}
					</label>,
				)
			}
		} else {
			checkedColumns.push(
				<label key={column} className="list-landing-settings-checkbox-item">
					<input
						type="checkbox"
						id={`${column}-checkbox`}
						name={`${column}-checkbox`}
					/>
					{(column.charAt(0).toUpperCase() + column.substr(1))
						.split(/(?=[A-Z])/)
						.join(' ')}
				</label>,
			)
		}
	}

	return checkedColumns
}

async function handleSubmit(
	e: any,
	columns: string[],
	watchlist: any,
	listParams: any,
) {
	e.preventDefault()

	let columnsFormatted = columns.map(column => `${column}-checkbox`)
	let columnArray: string[] = []

	const formRaw = new FormData(e.target)
	const data = formRaw.entries()
	let settingsObject: Record<string, any> = {}

	for (const entry of data) {
		if (columnsFormatted.includes(entry[0])) {
			let tailIndex = entry[0].lastIndexOf('-checkbox')
			columnArray.push(entry[0].slice(0, tailIndex))
		} else {
			let tailIndex = entry[0].lastIndexOf('-input')
			let settingType = entry[0].slice(0, tailIndex)

			if (settingType == 'name') {
				settingsObject['header'] = entry[1]
				settingsObject['name'] = (entry[1] as string)
					.replace(/\W/g, '')
					.toLowerCase()
			} else if (settingType == 'visibility') {
				settingsObject['isPublic'] = entry[1] === 'public'
			} else if (settingType == 'defaultSortColumn') {
				settingsObject['defaultSortColumn'] =
					entry[1] === 'manual' ? null : entry[1]
			} else {
				settingsObject[settingType] = entry[1]
			}
		}
	}

	const foundColumns = columnArray.join(', ')
	settingsObject['displayedColumns'] = foundColumns

	let errorArray = []

	if (!settingsObject['header'] || settingsObject['header'].length < 3) {
		errorArray.push('header')
	}

	if (!foundColumns || foundColumns.length < 1) {
		errorArray.push('displayedColumns')
	}

	if (errorArray.length > 0) {
		listParams.setSettingsErrors({
			...listParams.settingsErrors,
			[watchlist.id]: errorArray,
		})
	} else {
		listParams.setSettingsErrors({
			...listParams.settingsErrors,
			[watchlist.id]: null,
		})

		const updateSettingsResponse = await fetch(
			'/lists/fetch/update-settings/' +
				encodeURIComponent(
					new URLSearchParams({
						authorization: listParams.VEUD_API_KEY,
						settings: JSON.stringify(
							Object.keys(settingsObject).map(key => [
								key,
								settingsObject[key],
							]),
						),
						listId: watchlist.id,
						listTypeData: JSON.stringify(listParams.listTypeData),
						ownerId: listParams.listOwner.id,
					} as any).toString(),
				),
			{ method: 'POST' },
		)
		const updateSettingsData =
			(await updateSettingsResponse.json()) as Array<any>

		await fetch(
			'/lists/fetch/now-updated/' +
				encodeURIComponent(
					new URLSearchParams({
						authorization: listParams.VEUD_API_KEY,
						watchlistId: watchlist.id,
					} as any).toString(),
				),
			{ method: 'POST' },
		)

		const updatedWatchlist = updateSettingsData.slice(-1)[0]
		listParams.setWatchListData((current: any[]) =>
			current.map(item =>
				item.watchlist.id === watchlist.id
					? { ...item, watchlist: updatedWatchlist }
					: item,
			),
		)

		listParams.setShownSettings((oldValues: any) => {
			return oldValues.filter((setting: any) => setting !== watchlist.id)
		})
	}
}

export function GetWatchlistSettings(entryData: any, listParams: any) {
	const columns = Object.keys(
		JSON.parse(listParams.listTypeData.columns) as Record<string, unknown>,
	)
	const sortableColumns = getSortableWatchlistColumns(
		listParams.listTypeData.columns,
	)
	const displayedColumns = entryData.watchlist.displayedColumns.split(', ')
	const checkedColumns = checkDisplayedColumns(columns, displayedColumns)

	return (
		<Form
			key={entryData.watchlist.id}
			method="post"
			onSubmit={e => {
				handleSubmit(e, columns, entryData.watchlist, listParams)
			}}
		>
			<div className="list-landing-nav-item-container">
				<div className="list-landing-nav-top">
					<h2 className="list-landing-nav-header">
						{entryData.watchlist.header}
					</h2>
					<div className="list-landing-nav-length">
						{entryData.listEntries.length}
					</div>
				</div>
				<div className="list-landing-nav-bottom-container">
					<div className="list-landing-nav-bottom">
						<div>
							<div className="list-landing-settings-container">
								<div className="list-landing-settings-input-row">
									<div>Name *</div>
									<input
										className="list-landing-settings-input-item"
										id="name-input"
										name="name-input"
										defaultValue={entryData.watchlist.header}
										maxLength={150}
									/>
									{listParams.settingsErrors[entryData.watchlist.id]?.includes(
										'header',
									) ? (
										<em>Name must be at least 3 characters long</em>
									) : null}
								</div>
								<div className="list-landing-settings-input-row">
									<div>Description</div>
									<textarea
										className="list-landing-settings-input-item"
										id="description-input"
										name="description-input"
										cols={50}
										rows={5}
										defaultValue={entryData.watchlist.description}
										maxLength={1000}
									></textarea>
								</div>
								<div className="list-landing-settings-input-row">
									<label htmlFor={`visibility-${entryData.watchlist.id}`}>
										Visibility
									</label>
									<select
										className="list-landing-settings-input-item"
										id={`visibility-${entryData.watchlist.id}`}
										name="visibility-input"
										defaultValue={
											entryData.watchlist.isPublic ? 'public' : 'private'
										}
									>
										<option value="public">Public — visible to everyone</option>
										<option value="private">
											Private — only visible to you
										</option>
									</select>
									<small>
										Private lists are hidden from direct links, profiles, feeds,
										search, and community activity.
									</small>
								</div>
								<div className="list-landing-settings-input-row">
									<label
										htmlFor={`default-sort-column-${entryData.watchlist.id}`}
									>
										Default sorting
									</label>
									<select
										className="list-landing-settings-input-item"
										id={`default-sort-column-${entryData.watchlist.id}`}
										name="defaultSortColumn-input"
										defaultValue={
											entryData.watchlist.defaultSortColumn ?? 'manual'
										}
									>
										<option value="manual">Manual position</option>
										{sortableColumns.map(column => (
											<option key={column} value={column}>
												{watchlistColumnLabel(column)}
											</option>
										))}
									</select>
									<select
										className="list-landing-settings-input-item"
										id={`default-sort-direction-${entryData.watchlist.id}`}
										name="defaultSortDirection-input"
										defaultValue={
											entryData.watchlist.defaultSortDirection ?? 'asc'
										}
										aria-label="Default sort direction"
									>
										<option value="asc">Ascending</option>
										<option value="desc">Descending</option>
									</select>
									<small>
										Manual position preserves your drag order. Other choices are
										applied when this list opens; header sorting remains
										temporary.
									</small>
								</div>
								<div className="list-landing-settings-input-row">
									<div>Columns *</div>
									<div className="list-landing-settings-checkbox-container">
										{checkedColumns}
									</div>
									{listParams.settingsErrors[entryData.watchlist.id]?.includes(
										'displayedColumns',
									) ? (
										<em>Must display at least one column</em>
									) : null}
								</div>
								<button
									type="button"
									className="list-landing-settings-delete-button"
									onClick={async () => {
										await fetch(
											'/lists/fetch/delete-watchlist/' +
												encodeURIComponent(
													new URLSearchParams({
														authorization: listParams.VEUD_API_KEY,
														id: entryData.watchlist.id,
														listTypeData: JSON.stringify(
															listParams.listTypeData,
														),
														ownerId: listParams.listOwner.id,
													} as any).toString(),
												),
											{ method: 'POST' },
										)

										listParams.setWatchListData((current: any[]) =>
											current.filter(
												item => item.watchlist.id !== entryData.watchlist.id,
											),
										)
									}}
								>
									<div className="list-landing-settings-delete-icon">
										<Icon name="trash"></Icon>
									</div>
									<span className="list-landing-settings-delete-text">
										Delete
									</span>
								</button>
							</div>
							<div className="list-landing-nav-last-updated-container">
								Last Updated:
								<span className="list-landing-nav-last-updated-span">
									{timeSince(new Date(entryData.watchlist.updatedAt))}
								</span>
							</div>
						</div>
					</div>
				</div>
				<div className="list-landing-nav-link-container">
					<button
						type="submit"
						id="list-landing-settings-submit-button"
						name="list-landing-settings-submit-button"
						className="list-landing-settings-submit"
					>
						Submit
					</button>
					<button
						type="button"
						id="list-landing-settings-cancel-button"
						name="list-landing-settings-cancel-button"
						className="list-landing-settings-cancel"
						onClick={() => {
							listParams.setShownSettings((oldValues: any) => {
								return oldValues.filter(
									(setting: any) => setting !== entryData.watchlist.id,
								)
							})
						}}
					>
						Cancel
						<span className="list-landing-settings-close-span">ⓧ</span>
					</button>
				</div>
			</div>
			<Spacer size="xs" />
		</Form>
	)
}
