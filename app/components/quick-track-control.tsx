import { useEffect, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { type action as quickTrackAction } from '#app/routes/resources+/quick-track.ts'
import { listTypeNameForMediaKind } from '#app/utils/media-detail.ts'
import { cn } from '#app/utils/misc.tsx'

export type QuickTrackMedia = {
	id: string
	kind: string
	title: string
	viewerTracking: {
		status: string
		statusWatchlistId: string | null
	} | null
}

export type QuickTrackWatchlist = {
	id: string
	name: string
	header: string
	position: number
	type: { name: string }
}

export function QuickTrackControl({
	item,
	watchlists,
	isSignedIn,
	loginRedirectTo,
	layout = 'row',
	onTracked,
}: {
	item: QuickTrackMedia
	watchlists: QuickTrackWatchlist[]
	isSignedIn: boolean
	loginRedirectTo: string
	layout?: 'row' | 'stacked'
	onTracked?: () => void
}) {
	const fetcher = useFetcher<typeof quickTrackAction>()
	const listTypeName = listTypeNameForMediaKind(item.kind)
	const compatible = listTypeName
		? watchlists.filter(watchlist => watchlist.type.name === listTypeName)
		: []
	const savedWatchlistId = compatible.some(
		watchlist => watchlist.id === item.viewerTracking?.statusWatchlistId,
	)
		? item.viewerTracking?.statusWatchlistId
		: compatible[0]?.id
	const [selectedWatchlistId, setSelectedWatchlistId] = useState(
		savedWatchlistId ?? '',
	)

	useEffect(() => {
		setSelectedWatchlistId(savedWatchlistId ?? '')
	}, [savedWatchlistId])
	const trackedWatchlistId = fetcher.data?.ok
		? fetcher.data.tracking.watchlistId
		: null
	useEffect(() => {
		if (trackedWatchlistId) onTracked?.()
	}, [onTracked, trackedWatchlistId])

	if (!isSignedIn) {
		const loginParams = new URLSearchParams({ redirectTo: loginRedirectTo })
		return (
			<Button asChild size="sm" variant="outline" className="w-full">
				<Link to={`/login?${loginParams}`}>Log in to track</Link>
			</Button>
		)
	}
	if (!compatible.length) {
		return (
			<p className="text-center text-xs text-[#8ca99d]">
				Create a compatible watchlist to track this title.
			</p>
		)
	}

	const busy = fetcher.state !== 'idle'
	const saved =
		fetcher.data?.ok &&
		fetcher.data.tracking.watchlistId === selectedWatchlistId
	const verb = item.viewerTracking || fetcher.data?.ok ? 'Update' : 'Track'

	return (
		<fetcher.Form
			method="post"
			action="/resources/quick-track"
			className={cn('flex gap-2', layout === 'stacked' && 'flex-col')}
		>
			<input type="hidden" name="mediaId" value={item.id} />
			<select
				name="watchlistId"
				value={selectedWatchlistId}
				onChange={event => setSelectedWatchlistId(event.currentTarget.value)}
				disabled={busy}
				aria-label={`Tracking status for ${item.title}`}
				className="h-9 min-w-0 flex-1 rounded-md border border-[#54806c] bg-[#2e2f2b] px-2 text-xs text-[#ffefcc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a2ffd5]"
			>
				{compatible.map(watchlist => (
					<option key={watchlist.id} value={watchlist.id}>
						{watchlist.header}
					</option>
				))}
			</select>
			<Button
				type="submit"
				size="sm"
				variant="outline"
				disabled={busy || !selectedWatchlistId}
				aria-label={`${verb} ${item.title}`}
				className={cn(layout === 'stacked' && 'w-full')}
			>
				{busy ? 'Saving…' : saved ? 'Saved' : verb}
			</Button>
		</fetcher.Form>
	)
}
