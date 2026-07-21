import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
	QuickTrackControl,
	type QuickTrackWatchlist,
} from '#app/components/quick-track-control.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	type HomeTrendingItem,
	type HomeTrendingRail,
} from '#app/utils/home-trending.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

function TrendingCard({
	item,
	watchlists,
	isSignedIn,
}: {
	item: HomeTrendingItem
	watchlists: QuickTrackWatchlist[]
	isSignedIn: boolean
}) {
	const { imageUrl } = splitLegacyThumbnail(item.thumbnail)

	return (
		<article className="home-trending-card w-44 shrink-0 snap-start overflow-hidden rounded-xl shadow-lg shadow-black/20">
			<Link
				to={`/media/${item.id}`}
				className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#a2ffd5]"
			>
				<div className="relative aspect-[2/3] overflow-hidden bg-[#2e2f2b]">
					{imageUrl ? (
						<img
							src={imageUrl}
							alt=""
							loading={item.rank > 6 ? 'lazy' : 'eager'}
							className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
						/>
					) : (
						<span className="flex h-full items-center justify-center px-4 text-center text-xs font-bold text-[#8ca99d]">
							No poster available
						</span>
					)}
					<span className="absolute left-2 top-2 rounded-full bg-[#222]/90 px-2 py-1 text-xs font-black text-[#ffcc66]">
						#{item.rank}
					</span>
				</div>
				<div className="min-h-24 p-3">
					<h4 className="line-clamp-2 font-black leading-5 text-[#ffffb1] group-hover:underline">
						{item.title}
					</h4>
					<p className="mt-1 text-xs text-[#a2ffd5]">
						{item.type || item.kind}
						{item.year ? ` · ${item.year}` : ''}
						{item.score !== null ? ` · ★ ${item.score.toFixed(1)}` : ''}
					</p>
				</div>
			</Link>
			<div className="home-trending-card-actions p-3">
				<QuickTrackControl
					item={item}
					watchlists={watchlists}
					isSignedIn={isSignedIn}
					loginRedirectTo="/"
					layout="stacked"
				/>
			</div>
		</article>
	)
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
	return (
		<svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
			<path
				d="M12.5 4.5 7 10l5.5 5.5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
				transform={direction === 'right' ? 'rotate(180 10 10)' : undefined}
			/>
		</svg>
	)
}

function TrendingRail({
	rail,
	watchlists,
	isSignedIn,
}: {
	rail: HomeTrendingRail
	watchlists: QuickTrackWatchlist[]
	isSignedIn: boolean
}) {
	const scroller = useRef<HTMLDivElement>(null)
	const [scrollEdges, setScrollEdges] = useState({ atStart: true, atEnd: true })
	const headingId = `home-trending-${rail.kind}`
	const updateScrollEdges = () => {
		const element = scroller.current
		if (!element) return
		const maximum = Math.max(0, element.scrollWidth - element.clientWidth)
		setScrollEdges({
			atStart: element.scrollLeft <= 2,
			atEnd: element.scrollLeft >= maximum - 2,
		})
	}
	const scroll = (direction: -1 | 1) => {
		scroller.current?.scrollBy({
			left: direction * Math.max(320, scroller.current.clientWidth * 0.8),
			behavior: 'smooth',
		})
	}

	useEffect(() => {
		const element = scroller.current
		if (!element) return
		updateScrollEdges()
		element.addEventListener('scroll', updateScrollEdges, { passive: true })
		const resizeObserver = new ResizeObserver(updateScrollEdges)
		resizeObserver.observe(element)
		return () => {
			element.removeEventListener('scroll', updateScrollEdges)
			resizeObserver.disconnect()
		}
	}, [rail.items.length])

	return (
		<section aria-labelledby={headingId} className="min-w-0 space-y-3">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-baseline gap-3">
					<h3 id={headingId} className="text-xl font-black text-[#ffffb1]">
						{rail.title}
					</h3>
					<Link
						to={`/discover?kind=${rail.kind}&sort=popular`}
						className="text-xs font-bold text-[#a2ffd5] hover:underline"
					>
						View all
					</Link>
				</div>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={() => scroll(-1)}
						disabled={scrollEdges.atStart}
						aria-label={`Scroll ${rail.title} left`}
					>
						<ArrowIcon direction="left" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={() => scroll(1)}
						disabled={scrollEdges.atEnd}
						aria-label={`Scroll ${rail.title} right`}
					>
						<ArrowIcon direction="right" />
					</Button>
				</div>
			</header>

			{/* A focusable overflow region enables arrow-key scrolling across browsers. */}
			{/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
			<div
				ref={scroller}
				data-testid={`trending-rail-${rail.kind}`}
				tabIndex={0}
				role="region"
				aria-label={`${rail.title} titles`}
				data-at-start={scrollEdges.atStart}
				data-at-end={scrollEdges.atEnd}
				onKeyDown={event => {
					if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
					event.preventDefault()
					scroll(event.key === 'ArrowLeft' ? -1 : 1)
				}}
				className="home-trending-rail flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth py-2"
			>
				{rail.items.map(item => (
					<TrendingCard
						key={item.id}
						item={item}
						watchlists={watchlists}
						isSignedIn={isSignedIn}
					/>
				))}
			</div>
			{/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
		</section>
	)
}

export function TrendingData({
	rails,
	watchlists,
	isSignedIn,
}: {
	rails: HomeTrendingRail[]
	watchlists: QuickTrackWatchlist[]
	isSignedIn: boolean
}) {
	const [selectedIndex, setSelectedIndex] = useState(0)
	useEffect(() => {
		if (selectedIndex >= rails.length) setSelectedIndex(0)
	}, [rails.length, selectedIndex])
	const selectedRail = rails[selectedIndex] ?? rails[0]
	const mediaTypeOptions = rails.map(rail => ({
		key: rail.kind,
		label:
			rail.kind === 'tv'
				? 'TV'
				: rail.kind.charAt(0).toUpperCase() + rail.kind.slice(1),
	}))

	return (
		<section
			aria-labelledby="home-trending-heading"
			className="home-trending-section w-full max-w-7xl space-y-6 self-center text-[#ffefcc]"
		>
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-xs font-black uppercase tracking-[0.2em] text-[#a2ffd5]">
						Discover what’s moving
					</p>
					<h2
						id="home-trending-heading"
						className="mt-1 text-3xl font-black text-[#ff9900] sm:text-4xl"
					>
						Trending now
					</h2>
					<p className="mt-2 max-w-2xl text-sm text-[#c6ded2]">
						Fresh provider charts backed by Veud’s canonical catalog, with
						popular fallbacks whenever a chart has not refreshed yet.
					</p>
				</div>
				<Button asChild variant="outline">
					<Link to="/discover">Explore the catalog</Link>
				</Button>
			</header>

			{selectedRail ? (
				<div className="min-w-0 space-y-5">
					<div
						className="home-media-tabs"
						role="tablist"
						aria-label="Trending media type"
					>
						{mediaTypeOptions.map((option, index) => (
							<button
								key={option.key}
								type="button"
								role="tab"
								aria-selected={index === selectedIndex}
								className="home-media-tab"
								onClick={() => setSelectedIndex(index)}
							>
								{option.label}
							</button>
						))}
					</div>
					<TrendingRail
						key={selectedRail.kind}
						rail={selectedRail}
						watchlists={watchlists}
						isSignedIn={isSignedIn}
					/>
				</div>
			) : (
				<div className="rounded-xl border border-dashed border-[#54806c] bg-[#383040] px-6 py-12 text-center">
					<h3 className="font-black text-[#ffffb1]">
						Catalog charts are warming up
					</h3>
					<p className="mt-1 text-sm text-[#a2ffd5]">
						Trending titles will appear after the first catalog inventory or
						feed refresh.
					</p>
				</div>
			)}

			{!isSignedIn ? (
				<div className="overflow-hidden rounded-2xl border border-[#54806c] bg-gradient-to-r from-[#383040] to-[#403530] p-6 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-8">
					<div>
						<h3 className="text-2xl font-black text-[#ffffb1]">
							Make it yours
						</h3>
						<p className="mt-2 max-w-2xl text-[#c6ded2]">
							Build personal lists, keep a viewing diary, and turn these charts
							into your next watch.
						</p>
					</div>
					<Button asChild className="mt-5 w-full sm:mt-0 sm:w-auto">
						<Link to="/signup">Join Veud</Link>
					</Button>
				</div>
			) : null}
		</section>
	)
}
