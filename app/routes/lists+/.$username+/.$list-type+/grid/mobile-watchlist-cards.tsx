import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { MediaSearchBar } from '#app/components/search-add-watchlist-entry.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { getThumbnailInfo } from '#app/utils/lists/column-functions.tsx'
import {
	averageScores,
	providedScore,
	formatScore,
	scoreDifference,
} from '#app/utils/lists/score-formatters.ts'
import { watchlistColumnLabel } from '#app/utils/lists/default-sort.ts'
import { AdvancedEntryEditor } from './advanced-entry-editor.tsx'
import { moveEntry, refreshGrid } from './grid-actions.ts'

type MobileSort = {
	colId: string
	sort: 'asc' | 'desc'
}

function counterValue(value: unknown) {
	const matches =
		String(value ?? '')
			.match(/\d+/g)
			?.map(Number) ?? []
	if (!matches.length) return null
	return {
		current: matches.length > 1 ? matches[0] : 0,
		total: matches.length > 1 ? matches[1] : matches[0],
	}
}

export function mobileProgressForEntry(entry: any, listTypeName: string) {
	const preferredUnit = listTypeName === 'manga' ? 'chapter' : 'episode'
	const normalized = entry.trackingState?.progress?.find(
		(progress: any) => progress.unit === preferredUnit,
	)
	if (normalized) {
		const current = Number(normalized.current) || 0
		const total = Number(normalized.total) || 0
		return total > 0 ? `${current} / ${total}` : String(current)
	}

	const legacy =
		listTypeName === 'manga'
			? (counterValue(entry.chapters) ?? counterValue(entry.volumes))
			: counterValue(entry.length)
	if (!legacy) return null
	return legacy.total > 0
		? `${legacy.current} / ${legacy.total}`
		: String(legacy.current)
}

function comparableValue(entry: any, colId: string) {
	if (colId === 'position') return Number(entry.position) || 0
	const categoryAverage = averageScores([
		entry.story,
		entry.character,
		entry.presentation,
		entry.sound,
		entry.performance,
		entry.enjoyment,
	])
	let value = entry[colId]
	if (['started', 'finished', 'added', 'lastUpdated'].includes(colId)) {
		try {
			const history = JSON.parse(String(entry.history ?? '{}')) as Record<
				string,
				unknown
			>
			value = history[colId]
		} catch {}
	}
	if (colId === 'averaged') value = categoryAverage
	if (colId === 'differencePersonal') {
		value = scoreDifference(entry.personal, categoryAverage)
	}
	if (colId === 'differenceObjective') {
		value = scoreDifference(
			entry.personal,
			providedScore(entry.tmdbScore) ?? providedScore(entry.malScore),
		)
	}
	if (value instanceof Date) return value.getTime()
	if (typeof value === 'string') {
		const timestamp = Date.parse(value)
		if (/date|release|updated|started|finished|added/i.test(colId)) {
			return Number.isNaN(timestamp) ? 0 : timestamp
		}
	}
	const numeric = Number(value)
	if (value !== '' && value !== null && Number.isFinite(numeric)) return numeric
	return String(value ?? '').toLocaleLowerCase()
}

export function filterAndSortMobileEntries(
	entries: any[],
	query: string,
	sort: MobileSort,
) {
	const normalizedQuery = query.trim().toLocaleLowerCase()
	return entries
		.filter(entry => entry.id && String(entry.title ?? '').trim())
		.filter(entry => {
			if (!normalizedQuery) return true
			return `${entry.title ?? ''} ${entry.type ?? ''}`
				.toLocaleLowerCase()
				.includes(normalizedQuery)
		})
		.sort((first, second) => {
			const firstValue = comparableValue(first, sort.colId)
			const secondValue = comparableValue(second, sort.colId)
			const comparison =
				typeof firstValue === 'number' && typeof secondValue === 'number'
					? firstValue - secondValue
					: String(firstValue).localeCompare(String(secondValue))
			return (
				(sort.sort === 'asc' ? comparison : -comparison) ||
				(Number(first.position) || 0) - (Number(second.position) || 0)
			)
		})
}

function entryScore(entry: any) {
	return (
		providedScore(entry.personal) ??
		averageScores([
			entry.story,
			entry.character,
			entry.presentation,
			entry.sound,
			entry.performance,
			entry.enjoyment,
		]) ??
		providedScore(entry.malScore) ??
		providedScore(entry.tmdbScore)
	)
}

export function MobileWatchlistCards({
	entries,
	columnParams,
	sortableColumns,
	defaultSort,
}: {
	entries: any[]
	columnParams: any
	sortableColumns: string[]
	defaultSort?: MobileSort
}) {
	const [query, setQuery] = useState('')
	const [sortColumn, setSortColumn] = useState(defaultSort?.colId ?? 'position')
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
		defaultSort?.sort ?? 'asc',
	)
	const isOwner = columnParams.currentUserId === columnParams.listOwner.id
	const availableSortColumns = Array.from(
		new Set(['position', 'title', ...sortableColumns]),
	)
	const visibleEntries = useMemo(
		() =>
			filterAndSortMobileEntries(entries, query, {
				colId: sortColumn,
				sort: sortDirection,
			}),
		[entries, query, sortColumn, sortDirection],
	)

	useEffect(() => {
		setQuery('')
		setSortColumn(defaultSort?.colId ?? 'position')
		setSortDirection(defaultSort?.sort ?? 'asc')
	}, [columnParams.watchlistId, defaultSort?.colId, defaultSort?.sort])

	async function submitPosition(event: FormEvent<HTMLFormElement>, entry: any) {
		event.preventDefault()
		const formData = new FormData(event.currentTarget)
		const position = Number(formData.get('position'))
		if (!Number.isInteger(position) || position < 1) return
		try {
			await moveEntry(entry.id, entry.watchlistId, position)
		} catch (error) {
			console.error('[watchlist] failed to move mobile list entry', error)
		} finally {
			await refreshGrid(columnParams)
		}
	}

	return (
		<section className="mobile-list-view" aria-label="Mobile list">
			<header className="mobile-list-toolbar">
				<div className="mobile-list-toolbar-summary" aria-live="polite">
					<strong>{visibleEntries.length}</strong>
					<span>{visibleEntries.length === 1 ? 'title' : 'titles'}</span>
				</div>
				{isOwner ? (
					<MediaSearchBar compactTrigger columnParams={columnParams} />
				) : null}
				<details className="mobile-list-tools">
					<summary>
						<Icon name="mixer-horizontal" aria-hidden="true" />
						<span>Filter &amp; sort</span>
						{query ? (
							<span className="mobile-list-tools-active">Active</span>
						) : null}
					</summary>
					<div className="mobile-list-tools-panel">
						<label className="mobile-list-filter">
							<span>Filter this list</span>
							<input
								type="search"
								value={query}
								placeholder="Title or type"
								onChange={event => setQuery(event.currentTarget.value)}
							/>
						</label>
						<div className="mobile-list-sort-controls">
							<label>
								<span>Sort by</span>
								<select
									value={sortColumn}
									onChange={event => setSortColumn(event.currentTarget.value)}
								>
									{availableSortColumns.map(column => (
										<option key={column} value={column}>
											{column === 'position'
												? 'Manual position'
												: watchlistColumnLabel(column)}
										</option>
									))}
								</select>
							</label>
							<label>
								<span>Direction</span>
								<select
									value={sortDirection}
									onChange={event =>
										setSortDirection(
											event.currentTarget.value as 'asc' | 'desc',
										)
									}
								>
									<option value="asc">Ascending</option>
									<option value="desc">Descending</option>
								</select>
							</label>
						</div>
					</div>
				</details>
			</header>

			<div className="mobile-list-card-stack" aria-live="polite">
				{visibleEntries.length ? (
					visibleEntries.map(entry => {
						const thumbnail = getThumbnailInfo(entry.thumbnail)
						const progress = mobileProgressForEntry(
							entry,
							columnParams.listTypeData.name,
						)
						const score = entryScore(entry)
						return (
							<article
								key={entry.id}
								className="mobile-list-card"
								aria-label={entry.title}
							>
								<a
									className="mobile-list-card-poster"
									href={
										entry.mediaId
											? `/media/${encodeURIComponent(entry.mediaId)}`
											: thumbnail.url || undefined
									}
									aria-label={`Open ${entry.title}`}
								>
									<img
										src={
											thumbnail.content || '/favicons/favicon.png'
										}
										alt=""
										loading="lazy"
									/>
								</a>
								<div className="mobile-list-card-body">
									<div className="mobile-list-card-heading">
										<div>
											<p className="mobile-list-card-type">
												{entry.type || columnParams.listTypeData.header}
											</p>
											<h2>{entry.title}</h2>
										</div>
										<span className="mobile-list-card-position">
											#{entry.position}
										</span>
									</div>
									<dl className="mobile-list-card-stats">
										<div>
											<dt>Status</dt>
											<dd>{columnParams.watchListData.header}</dd>
										</div>
										<div>
											<dt>Progress</dt>
											<dd>{progress ?? '—'}</dd>
										</div>
										<div>
											<dt>Score</dt>
											<dd>{score === null ? '—' : formatScore(score, 1)}</dd>
										</div>
									</dl>
									{isOwner ? (
										<div className="mobile-list-card-actions">
											<form onSubmit={event => submitPosition(event, entry)}>
												<label>
													<span>Position</span>
													<Input
														name="position"
														type="number"
														min="1"
														defaultValue={entry.position}
														aria-label={`Move ${entry.title} to position`}
													/>
												</label>
											</form>
											<AdvancedEntryEditor
												params={{ data: entry }}
												idPrefix="mobile-"
											/>
										</div>
									) : null}
								</div>
							</article>
						)
					})
				) : (
					<div className="mobile-list-empty">
						<h2>No matching titles</h2>
						<p>Try another filter or add a title to this list.</p>
					</div>
				)}
			</div>
		</section>
	)
}
