// Row/cell action helpers for the watchlist grid, extracted from $watchlist_grid.jsx
// (Phase 3.2, increment 2). These use the versioned list resource API and drive ag-grid
// mutations. They read the shared gridAPI/columnParams from grid-state (and gridReady
// writes gridAPI via setGridAPI); refreshGrid keeps its own columnParams parameter, which
// shadows the import inside its body exactly as it did when this lived in the monolith.
import type { GridApi } from '@ag-grid-community/core'
import {
	gridAPI,
	columnParams,
	setGridAPI,
	type WatchlistColumnParams,
	type WatchlistRow,
} from './grid-state.ts'
import { mediaProgressParser } from '#app/utils/lists/column-functions.tsx'
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
		header: destination.header,
		path: `/lists/${columnParams.listOwner.username}/${columnParams.listTypeData.name}/${destination.name}`,
	}
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
		event.node.setDragging(true)
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

export function createEmptyRow(
	watchlistId: string,
	position: number,
	listTypeData: { columns: string },
) {
	const emptyRow: WatchlistRow = { watchlistId, position }

	for (const [key, value] of Object.entries(
		JSON.parse(listTypeData.columns) as Record<string, unknown>,
	)) {
		if (key == 'id') {
			continue
		}
		if (value == 'string') {
			emptyRow[key] = ' '
		} else if (value == 'number') {
			emptyRow[key] = 0
		} else if (value == 'date') {
			emptyRow[key] = null
		} else if (value == 'history') {
			emptyRow['history'] = JSON.stringify({
				added: Date.now(),
				started: null,
				finished: null,
				progress: null,
				lastUpdated: Date.now(),
			})
		}
	}

	return emptyRow
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
	const viewport = gridElement.querySelector<HTMLElement>('.ag-body-viewport')
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
		const draggedNode = gridAPI.getRowNode(dragSession.entryId)
		const position = (draggedNode?.rowIndex ?? params.overIndex ?? 0) + 1
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

export async function createNewRow(
	location: 'Above' | 'Below',
	params: { data: WatchlistRow },
) {
	let insertPosition = 0
	if (location == 'Above') {
		if (params.data.position < 1) {
			insertPosition = 0
		} else {
			insertPosition = params.data.position - 1
		}
	} else insertPosition = params.data.position

	const emptyRow = createEmptyRow(
		params.data.watchlistId,
		insertPosition,
		columnParams.listTypeData,
	)

	const addData = await mutateList<'add-entry', any>('add-entry', {
		row: emptyRow,
	})

	gridAPI.applyTransaction({ add: [addData], addIndex: insertPosition })

	await mutateList('touch-watchlist', {
		watchlistId: params.data.watchlistId,
	})

	updatePositions()
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
