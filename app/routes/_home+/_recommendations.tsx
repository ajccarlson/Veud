import { Link } from 'react-router'
import {
	QuickTrackControl,
	type QuickTrackWatchlist,
} from '#app/components/quick-track-control.tsx'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { type RecommendationGraph } from '#app/utils/recommendation-graph.ts'

export function HomeRecommendations({
	graph,
	watchlists,
}: {
	graph: RecommendationGraph | null
	watchlists: QuickTrackWatchlist[]
}) {
	const items =
		graph?.lanes
			.flatMap(lane => lane.items.map(item => ({ ...item, lane: lane.title })))
			.slice(0, 6) ?? []
	return (
		<div className="home-recommendations space-y-4">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-xs font-black uppercase tracking-[0.18em] text-[#a2ffd5]">
						Based on your activity
					</p>
					<h2 className="text-2xl font-black text-[#ff9900]">
						Recommendations
					</h2>
				</div>
				<Link
					to="/discover?sort=for-you"
					className="text-sm font-bold text-[#a2ffd5] hover:underline"
				>
					See every lane
				</Link>
			</header>
			{items.length ? (
				<div className="home-recommendation-grid">
					{items.map(item => {
						const poster = splitLegacyThumbnail(item.thumbnail).imageUrl
						return (
							<article key={item.id} className="home-recommendation-card">
								<Link to={`/media/${item.id}`} className="flex min-w-0 gap-3">
									<div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-[#2e2f2b]">
										{poster ? (
											<img
												src={poster}
												alt=""
												loading="lazy"
												className="h-full w-full object-cover"
											/>
										) : null}
									</div>
									<div className="min-w-0">
										<p className="text-[0.65rem] font-black uppercase tracking-wide text-[#ffcc66]">
											{item.lane}
										</p>
										<h3 className="line-clamp-2 font-black text-[#ffffb1]">
											{item.title}
										</h3>
										<p className="mt-1 line-clamp-2 text-xs leading-5 text-[#c6ded2]">
											{item.reasons[0]}
										</p>
									</div>
								</Link>
								<div className="mt-3 border-t border-[#54806c]/50 pt-2">
									<QuickTrackControl
										item={item}
										watchlists={watchlists}
										isSignedIn
										loginRedirectTo="/"
										layout="stacked"
									/>
								</div>
							</article>
						)
					})}
				</div>
			) : (
				<div className="home-dashboard-empty">
					Rate or favorite a few titles to unlock explainable recommendations.
				</div>
			)}
		</div>
	)
}
