// The position column for the watchlist grid (Phase 3.2, increment 3) — the row-management
// cell: a move-row Form, and a dropdown with insert-above/below, delete, update-entry,
// update-all, and add/remove-favorite. By far the most involved single column. Returned as a
// one-element array (spread into columnDefs()) for uniformity with the other column groups.
import { Form } from 'react-router'
import { Input } from '#app/components/ui/input.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from '#app/components/ui/dropdown-menu.tsx'
import { AdvancedEntryEditor } from './advanced-entry-editor.tsx'
import { gridAPI, columnParams } from './grid-state.ts'
import { createNewRow, refreshGrid, moveEntry } from './grid-actions.ts'
import {
	getSiteIdSafe,
	getThumbnailInfo,
	updateRowInfo,
} from '#app/utils/lists/column-functions.tsx'

export function positionColumn() {
	return [
		{
			field: 'position',
			headerName: '#',
			editable: false,
			resizable: false,
			minWidth: 156,
			maxWidth: 164,
			filter: 'agNumberColumnFilter',
			rowDrag: columnParams.currentUserId == columnParams.listOwner.id,
			cellRenderer: (params: any) => {
				return (
					<div>
						{columnParams.currentUserId == columnParams.listOwner.id ? (
							<div className="ag-position-controls">
								<Form
									method="GET"
									className="ag-position-form"
									onSubmit={async (event: any) => {
										event.preventDefault()
										const formData = new FormData(event.currentTarget)
										const position = Number(formData.get('moveRowIndex'))
										if (
											!params.data.id ||
											!Number.isInteger(position) ||
											position < 1
										) {
											await refreshGrid(columnParams)
											return
										}
										try {
											await moveEntry(
												params.data.id,
												params.data.watchlistId,
												position,
											)
										} catch (error) {
											console.error(
												'[watchlist] failed to move entry to position',
												error,
											)
										} finally {
											await refreshGrid(columnParams)
										}
									}}
								>
									<Input
										name="moveRowIndex"
										type="number"
										min="1"
										className="ag-row-index ag-move-row-input"
										autoComplete="off"
										defaultValue={params.value}
										aria-label={`Move ${params.data.title || 'entry'} to position`}
									/>
								</Form>
								{params.data.id ? (
									<AdvancedEntryEditor params={params} />
								) : null}
								{params.data.id ? (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												className="ag-row-action-button"
												aria-label={`More actions for ${params.data.title || 'entry'}`}
												title="More row actions"
											>
												<Icon name="dots-horizontal" aria-hidden="true" />
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											sideOffset={8}
											align="start"
											className="min-w-56"
										>
											<DropdownMenuLabel>Row actions</DropdownMenuLabel>
											<DropdownMenuItem
												onSelect={event => {
													createNewRow('Above', params)
												}}
											>
												Insert 1 row above
											</DropdownMenuItem>
											<DropdownMenuItem
												onSelect={event => {
													createNewRow('Below', params)
												}}
											>
												Insert 1 row below
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												onSelect={async event => {
													const deleteResponse = await fetch(
														'/lists/fetch/delete-row/' +
															encodeURIComponent(
																new URLSearchParams({
																	authorization: columnParams.VEUD_API_KEY,
																	listTypeData: JSON.stringify(
																		columnParams.listTypeData,
																	),
																	id: params.data.id,
																} as any).toString(),
															),
														{ method: 'POST' },
													)
													if (!deleteResponse.ok) {
														await refreshGrid(columnParams)
														return
													}
													gridAPI.applyTransaction({ remove: [params.data] })
													await refreshGrid(columnParams)
												}}
											>
												Delete row
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												onSelect={async () => {
													await updateRowInfo(params, columnParams, false)
												}}
											>
												Update entry info
											</DropdownMenuItem>
											<DropdownMenuItem
												onSelect={async event => {
													const updates: Promise<unknown>[] = []
													gridAPI.forEachNode((rowNode: any) => {
														if (rowNode.data.id) {
															updates.push(
																updateRowInfo(rowNode, columnParams, true),
															)
														}
													})
													await Promise.all(updates)
													await refreshGrid(columnParams)
												}}
											>
												Update all watchlist entries
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											{columnParams.favoriteIds?.includes(
												getSiteIdSafe(
													getThumbnailInfo(params.data.thumbnail).url,
												)?.id,
											) ? (
												<DropdownMenuItem
													onSelect={async event => {
														const deleteRow = columnParams.typedFavorites[
															columnParams.listTypeData.id
														].filter((favorite: any) => {
															return (
																getSiteIdSafe(
																	getThumbnailInfo(favorite.thumbnail).url,
																)?.id ===
																getSiteIdSafe(
																	getThumbnailInfo(params.data.thumbnail).url,
																)?.id
															)
														})

														const deleteResponse = await fetch(
															'/lists/fetch/remove-favorite/' +
																encodeURIComponent(
																	new URLSearchParams({
																		authorization: columnParams.VEUD_API_KEY,
																		id: deleteRow[0].id,
																	} as any).toString(),
																),
															{ method: 'POST' },
														)

														columnParams.setFavoriteIds(
															columnParams.favoriteIds.filter(
																(favoriteId: any) =>
																	favoriteId !==
																	getSiteIdSafe(
																		getThumbnailInfo(params.data.thumbnail).url,
																	)?.id,
															),
														)
													}}
												>
													Remove from favorites
												</DropdownMenuItem>
											) : (
												<DropdownMenuItem
													onSelect={async event => {
														const addPosition =
															Object.entries(
																columnParams.typedFavorites[
																	columnParams.listTypeData.id
																],
															).length + 1
														const typeColumns = JSON.parse(
															columnParams.listTypeData.columns,
														) as any
														const startTypes = [
															'airYear',
															'startYear',
															'startSeason',
														]
														const startColumn = Object.keys(typeColumns).find(
															column => startTypes.includes(column),
														)

														const addRow = {
															position: addPosition,
															thumbnail: params.data.thumbnail,
															title: params.data.title,
															typeId: columnParams.listTypeData.id,
															mediaType: params.data.type,
															startYear: params.data[startColumn as any],
															ownerId: columnParams.listOwner.id,
														}

														const addResponse = await fetch(
															'/lists/fetch/add-favorite/' +
																encodeURIComponent(
																	new URLSearchParams({
																		authorization: columnParams.VEUD_API_KEY,
																		favorite: JSON.stringify(addRow),
																	} as any).toString(),
																),
															{ method: 'POST' },
														)

														columnParams.setFavoriteIds([
															...columnParams.favoriteIds,
															getSiteIdSafe(
																getThumbnailInfo(params.data.thumbnail).url,
															)?.id,
														])
													}}
												>
													Add to favorites
												</DropdownMenuItem>
											)}
										</DropdownMenuContent>
									</DropdownMenu>
								) : null}
							</div>
						) : (
							<div className="ag-row-index">{params.value}</div>
						)}
					</div>
				)
			},
			cellClass: 'ag-position-cell',
			hide: !columnParams.displayedColumns['position'],
		},
	]
}
