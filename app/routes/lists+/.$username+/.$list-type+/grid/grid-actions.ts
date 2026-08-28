// Row/cell action helpers for the watchlist grid, extracted from $watchlist_grid.jsx
// (Phase 3.2, increment 2). These use the versioned list resource API and drive ag-grid
// mutations. They read the shared gridAPI/columnParams from grid-state (and gridReady
// writes gridAPI via setGridAPI); refreshGrid keeps its own columnParams parameter, which
// shadows the import inside its body exactly as it did when this lived in the monolith.
import type { GridApi } from 'ag-grid-community'
import {
	gridAPI,
	columnParams,
	setGridAPI,
	type WatchlistColumnParams,
	type WatchlistRow,
} from './grid-state.ts'
import { mediaProgressParser } from '#app/utils/lists/column-functions.tsx'
import {
	getSortableWatchlistColumns,
	getWatchlistDefaultSortModel,
} from '#app/utils/lists/default-sort.ts'
import { isManualRowOrder } from '#app/utils/lists/insert-boundary.ts'
import {
	getWatchlistEntries,
	mutateList,
} from '#app/utils/lists/mutation-client.ts'

export async function moveEntry(
	entryId: string,
	destinationWatchlistId: string,
	position?: number,
) {
	return mutateList('move-entry', {
		entryId,
		destinationWatchlistId,
		...(position === undefined ? {} : { position }),
	})
}

const DESTINATION_PREVIEW_DELAY = 550
const DRAG_SCROLL_EDGE = 72
const DRAG_SCROLL_MAX_SPEED = 18

type DragSession = {
	entryId: string
	sourceWatchlistId: string
	destinationWatchlistId: string | null
	destinationPath: string | null
	activated: boolean
	committing: boolean
}

let dragSession: DragSession | null = null
let destinationHoverTimer: ReturnType<typeof setTimeout> | null = null
let destinationRequest = 0
let dragScrollFrame: number | null = null
let dragScrollSpeed = 0
let dragScrollViewport: HTMLElement | null = null
let registeredDropZones: Array<{ container: Element; params: any }> = []
let activeDragEvent: any = null
let hoveredDestinationWatchlistId: string | null = null
/**
 * The grid's sort before a drag previewed another list.
 *
 * Captured as actual column state rather than recomputed from the source
 * watchlist's saved default, so a column the viewer clicked survives the drag.
 * One drag can preview several destinations in turn, so this is taken once and
 * cleared only when the whole drag ends.
 */
let preDragSortState: ReturnType<GridApi['getColumnState']> | null = null

function handleGlobalDragMove(mouseEvent: MouseEvent) {
	if (!dragSession || !activeDragEvent) return
	const target = document
		.elementsFromPoint(mouseEvent.clientX, mouseEvent.clientY)
		.map(element => element.closest<HTMLElement>('.list-nav-button'))
		.find((element): element is HTMLElement => element !== null)
	const destinationWatchlistId =
		target?.getAttribute('data-watchlist-id') ?? null
	if (destinationWatchlistId === hoveredDestinationWatchlistId) return

	clearDestinationTimer()
	document.querySelectorAll('.list-nav-drag-hover').forEach(button => {
		button.classList.remove('list-nav-drag-hover')
	})
	hoveredDestinationWatchlistId = destinationWatchlistId
	if (!target || !destinationWatchlistId) return

	target.classList.add('list-nav-drag-hover')
	if (
		!dragSession.activated &&
		destinationWatchlistId === dragSession.sourceWatchlistId
	) {
		return
	}
	const requestId = destinationRequest
	destinationHoverTimer = setTimeout(() => {
		if (requestId !== destinationRequest || !activeDragEvent) return
		void showDestinationPreview(activeDragEvent, destinationWatchlistId)
	}, DESTINATION_PREVIEW_DELAY)
}

function beginDragSession(event: any) {
	const entryId = event.node?.data?.id
	if (!entryId) return
	activeDragEvent = event
	if (dragSession?.entryId !== entryId) {
		dragSession = {
			entryId,
			sourceWatchlistId: event.node.data.watchlistId,
			destinationWatchlistId: null,
			destinationPath: null,
			activated: false,
			committing: false,
		}
		document.addEventListener('mousemove', handleGlobalDragMove)
	}
}

function clearDestinationTimer() {
	if (destinationHoverTimer) clearTimeout(destinationHoverTimer)
	destinationHoverTimer = null
	destinationRequest += 1
}

function clearDragScroll() {
	dragScrollSpeed = 0
	dragScrollViewport = null
	if (dragScrollFrame !== null) cancelAnimationFrame(dragScrollFrame)
	dragScrollFrame = null
	document
		.querySelector('.ag-theme-custom-react')
		?.classList.remove('ag-drag-scroll-up', 'ag-drag-scroll-down')
}

function clearDragExperience() {
	clearDestinationTimer()
	clearDragScroll()
	document.querySelectorAll('.list-nav-button').forEach(button => {
		button.classList.remove('list-nav-drag-hover', 'list-nav-drag-active')
	})
	document.removeEventListener('mousemove', handleGlobalDragMove)
	if (preDragSortState) {
		gridAPI?.applyColumnState({ state: preDragSortState })
		preDragSortState = null
	}
	activeDragEvent = null
	hoveredDestinationWatchlistId = null
	dragSession = null
}

function destinationDetails(watchlistId: string) {
	const destination = columnParams.typedWatchlists[
		columnParams.listTypeData.id
	]?.find(watchlist => watchlist.id === watchlistId)
	if (!destination) return null
	return {
		watchlist: destination,
		header: destination.header,
		path: `/lists/${columnParams.listOwner.username}/${columnParams.listTypeData.name}/${destination.name}`,
	}
}

/**
 * Show the grid under a watchlist's own sort.
 *
 * A cross-list drag reuses one grid instance, and the sort installed in it
 * belongs to the list being viewed — the source. Previewing another list's rows
 * without this renders them in the source's order, and the drop index taken
 * from that order is then written as a stored position in the destination, so
 * the entry lands somewhere nobody pointed at.
 *
 * `defaultState: { sort: null }` is what clears the source's sort when the
 * destination is ordered manually.
 */
function applyWatchlistSort(watchlist: {
	defaultSortColumn?: string | null
	defaultSortDirection?: string | null
}) {
	gridAPI?.applyColumnState({
		state: getWatchlistDefaultSortModel(
			watchlist,
			getSortableWatchlistColumns(columnParams.listTypeData.columns),
		),
		defaultState: { sort: null },
	})
}

async function fetchWatchlistEntries(watchlistId: string) {
	return (await getWatchlistEntries<WatchlistRow[]>(watchlistId)).sort(
		(first, second) => first.position - second.position,
	)
}

async function showDestinationPreview(event: any, watchlistId: string) {
	beginDragSession(event)
	if (!dragSession || dragSession.committing) return
	const requestId = destinationRequest
	const details = destinationDetails(watchlistId)
	if (!details) return

	try {
		const destinationEntries = await fetchWatchlistEntries(watchlistId)
		if (requestId !== destinationRequest || !dragSession) return

		// Inside the guard: a stale preview must not leave the grid sorted for a
		// destination the pointer already left.
		preDragSortState ??= gridAPI.getColumnState()
		applyWatchlistSort(details.watchlist)

		const draggedEntry = {
			...event.node.data,
			watchlistId,
			position: destinationEntries.length + 1,
		}
		gridAPI.applyTransaction({
			remove: getAllRows().filter(entry => entry.id !== dragSession?.entryId),
			add: destinationEntries.filter(
				entry => entry.id !== dragSession?.entryId,
			),
			addIndex: 0,
		})
		event.node.setData(draggedEntry)

		dragSession.destinationWatchlistId = watchlistId
		dragSession.destinationPath = details.path
		dragSession.activated = true
		document.querySelectorAll('.list-nav-button').forEach(button => {
			button.classList.toggle(
				'list-nav-drag-active',
				button.getAttribute('data-watchlist-id') === watchlistId,
			)
		})
	} catch (error) {
		console.error('[watchlist] failed to preview destination list', error)
	}
}

async function commitDraggedEntry(
	event: any,
	destinationWatchlistId: string,
	position?: number,
) {
	beginDragSession(event)
	if (!dragSession || dragSession.committing) return
	if (
		!dragSession.activated &&
		destinationWatchlistId === dragSession.sourceWatchlistId
	) {
		clearDragExperience()
		await refreshGrid(columnParams)
		return
	}

	const details = destinationDetails(destinationWatchlistId)
	dragSession.committing = true
	try {
		await moveEntry(dragSession.entryId, destinationWatchlistId, position)
		const shouldNavigate = destinationWatchlistId !== columnParams.watchlistId
		const destinationPath = details?.path ?? dragSession.destinationPath
		clearDragExperience()
		if (shouldNavigate && destinationPath) {
			columnParams.navigate(destinationPath)
		} else {
			await refreshGrid(columnParams)
		}
	} catch (error) {
		console.error('[watchlist] failed to move entry', error)
		clearDragExperience()
		await refreshGrid(columnParams)
	}
}

export function edgeScrollSpeed(clientY: number, top: number, bottom: number) {
	if (clientY < top + DRAG_SCROLL_EDGE) {
		const strength = (top + DRAG_SCROLL_EDGE - clientY) / DRAG_SCROLL_EDGE
		return -Math.ceil(
			Math.min(1, Math.max(0, strength)) * DRAG_SCROLL_MAX_SPEED,
		)
	}
	if (clientY > bottom - DRAG_SCROLL_EDGE) {
		const strength = (clientY - (bottom - DRAG_SCROLL_EDGE)) / DRAG_SCROLL_EDGE
		return Math.ceil(Math.min(1, Math.max(0, strength)) * DRAG_SCROLL_MAX_SPEED)
	}
	return 0
}

function runDragScroll() {
	if (!dragScrollViewport || dragScrollSpeed === 0) {
		dragScrollFrame = null
		return
	}
	const previousScrollTop = dragScrollViewport.scrollTop
	dragScrollViewport.scrollTop += dragScrollSpeed
	if (dragScrollViewport.scrollTop === previousScrollTop) {
		clearDragScroll()
		return
	}
	dragScrollFrame = requestAnimationFrame(runDragScroll)
}

export function gridReady(e: { api: GridApi<WatchlistRow> }) {
	setGridAPI(e.api)
	requestAnimationFrame(() => {
		registerListDropZones()
		document
			.querySelectorAll<HTMLElement>('.ag-header-viewport')
			.forEach(viewport => {
				const firstHeader = viewport.querySelector<HTMLElement>(
					'[role="columnheader"]',
				)
				if (firstHeader) firstHeader.tabIndex = 0
			})
	})
}

export function registerListDropZones() {
	if (!gridAPI) return
	for (const dropZone of registeredDropZones) {
		gridAPI.removeRowDropZone(dropZone.params)
		dropZone.container.classList.remove('list-nav-drop-ready')
	}
	registeredDropZones = []

	const navButtonContainers = document.querySelectorAll('.list-nav-button')

	navButtonContainers.forEach((navButtonContainer: any) => {
		const dropZone = {
			getContainer: () => {
				return navButtonContainer
			},
			onDragEnter: (event: any) => {
				beginDragSession(event)
				handleGlobalDragMove(event.event)
			},
			onDragging: (event: any) => handleGlobalDragMove(event.event),
			onDragStop: async (e: any) => {
				clearDestinationTimer()
				const destinationWatchlistId =
					navButtonContainer.getAttribute('data-watchlist-id')
				if (!e.node.data.id || !destinationWatchlistId) return
				await commitDraggedEntry(e, destinationWatchlistId)
			},
			onDragCancel: clearDragExperience,
		}
		gridAPI.addRowDropZone(dropZone)
		navButtonContainer.classList.add('list-nav-drop-ready')
		registeredDropZones.push({
			container: navButtonContainer,
			params: dropZone,
		})
	})
}

export function getAllRows() {
	const rowData: WatchlistRow[] = []
	gridAPI.forEachNode(node => {
		if (node.data) rowData.push(node.data)
	})
	return rowData
}

export async function refreshGrid(columnParams: WatchlistColumnParams) {
	const listEntriesData = (
		await getWatchlistEntries<WatchlistRow[]>(columnParams.watchlistId)
	).sort((a, b) => a.position - b.position)

	columnParams.setListEntries(listEntriesData)
	gridAPI?.setGridOption('rowData', listEntriesData)
}

export async function reformatHistory(params: any, newValue: any) {
	return mutateList('update-entry-cell', {
		columnId: params.column.colId,
		entryId: params.node.data.id,
		value: newValue,
	})
}

export function rowDragEnter(params: any) {
	beginDragSession(params)
}

export function rowDragMove(params: any) {
	beginDragSession(params)
	const gridElement = document.querySelector<HTMLElement>(
		'.ag-theme-custom-react',
	)
	if (!gridElement) return
	const viewport = gridElement.querySelector<HTMLElement>('.ag-grid-viewport')
	if (!viewport) return
	const bounds = viewport.getBoundingClientRect()
	dragScrollSpeed = edgeScrollSpeed(
		params.event.clientY,
		bounds.top,
		bounds.bottom,
	)
	dragScrollViewport = dragScrollSpeed === 0 ? null : viewport
	gridElement.classList.toggle('ag-drag-scroll-up', dragScrollSpeed < 0)
	gridElement.classList.toggle('ag-drag-scroll-down', dragScrollSpeed > 0)
	if (dragScrollSpeed === 0) {
		clearDragScroll()
	} else if (dragScrollFrame === null) {
		dragScrollFrame = requestAnimationFrame(runDragScroll)
	}
}

export function rowDragLeave() {
	clearDragScroll()
}

export async function rowDragCancel() {
	const hadPreview = dragSession?.activated
	clearDragExperience()
	if (hadPreview) await refreshGrid(columnParams)
}

export async function rowDragEnd(params: any) {
	clearDragScroll()
	if (!params.node.data.id) {
		clearDragExperience()
		await refreshGrid(columnParams)
		return
	}
	if (dragSession?.activated && dragSession.destinationWatchlistId) {
		// A drop index is only a stored position when the visible order is the
		// stored order. With the destination's own sort now installed, this asks
		// about the destination rather than about the list we came from. Under a
		// column sort there is no gap to point at, so the entry appends — the
		// same thing dropping straight onto the list's tab does.
		const draggedNode = gridAPI.getRowNode(dragSession.entryId)
		const position = isManualRowOrder(gridAPI.getColumnState())
			? (draggedNode?.rowIndex ?? params.overIndex ?? 0) + 1
			: undefined
		await commitDraggedEntry(
			params,
			dragSession.destinationWatchlistId,
			position,
		)
		return
	}
	clearDragExperience()
	await updatePositions()
}

export const rowDragText = function (params: any) {
	return `${params.rowNode.data?.title ?? 'Untitled'} (${(params.rowNode.rowIndex ?? 0) + 1})`
}

export async function updatePositions() {
	const entryIds = getAllRows()
		.map(row => row.id)
		.filter((id): id is string => typeof id === 'string' && id.length > 0)
	try {
		await mutateList('reorder-entries', {
			watchlistId: columnParams.watchlistId,
			entryIds,
		})
	} catch (error) {
		console.error('[watchlist] failed to reorder entries', error)
	} finally {
		await refreshGrid(columnParams)
	}
}

export async function setterFunction(params: any) {
	let returnValue = true

	if (params.column.colId == 'position') {
		updatePositions()
	} else if (params.data != params.newValue) {
		if (params.column.colId.toLowerCase() == 'length') {
			const fullLengthRegex = /\d+\s*\/\s*\d+ eps/g
			const partialLengthRegex = /\d*\s*\/*\s*\d+ eps/g

			if (!isNaN(params.newValue)) {
				try {
					if (fullLengthRegex.test(params.oldValue)) {
						params.newValue = params.oldValue.replace(/[0-9]+/, params.newValue)
					} else {
						throw new Error()
					}
				} catch (e) {
					if (partialLengthRegex.test(params.oldValue)) {
						const lengthData = mediaProgressParser(
							params,
							columnParams,
							params.oldValue,
							params.newValue,
						) as any
						params.newValue = `${lengthData.progress} / ${lengthData.total} eps`
					}
				}
			}
		} else if (
			params.column.colId.toLowerCase() == 'chapters' ||
			params.column.colId.toLowerCase() == 'volumes'
		) {
			const mediaData = mediaProgressParser(
				params,
				columnParams,
				params.oldValue,
				params.newValue,
			) as any
			params.newValue = `${mediaData.progress} / ${mediaData.total}`
		}

		params.data[params.column.colId] = params.newValue

		await mutateList('update-entry-cell', {
			columnId: params.column.colId,
			entryId: params.data.id,
			value: params.newValue,
		})

		await mutateList('touch-watchlist', {
			watchlistId: params.data.watchlistId,
		})

		if (
			['length', 'chapters', 'volumes', 'date', 'finished', 'started'].includes(
				params.column.colId.toLowerCase(),
			)
		) {
			refreshGrid(columnParams)
		}
	} else {
		returnValue = false
	}

	return returnValue
}
