/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Horizontal overflow regions must be keyboard-scrollable. */
import { Link } from 'react-router'
import {
	QuickTrackControl,
	type QuickTrackWatchlist,
} from '#app/components/quick-track-control.tsx'
import {
	RecommendationFeedbackControl,
	RestoreRecommendationControl,
} from '#app/components/recommendation-feedback-control.tsx'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { type RecommendationGraph } from '#app/utils/recommendation-graph.ts'

export function RecommendationLanes({
	graph,
	watchlists,
	loginRedirectTo,
}: {
	graph: RecommendationGraph
	watchlists: QuickTrackWatchlist[]
	loginRedirectTo: string
}) {
	if (!graph.lanes.length) {
		return (
			<section
				className="rounded-2xl border border-[#54806c]/70 bg-[#2e2f2b]/80 p-5"
				aria-labelledby="recommendation-lanes-heading"
			>
				<p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffcc66]">
					Personal discovery
				</p>
				<h2
					id="recommendation-lanes-heading"
					className="mt-1 text-2xl font-black text-[#ffffb1]"
				>
					Recommendations for you
				</h2>
				<p className="mt-2 max-w-3xl text-sm leading-6 text-[#c6ded2]">
					Rate or favorite a few titles, revisit something you love, follow
					members, or like a public collection. Veud will explain which of those
					private signals shaped every recommendation.
				</p>
				{graph.hiddenItems.length ? (
					<details className="mt-4 rounded-xl border border-[#54806c]/60 bg-[#242525] p-3">
						<summary className="cursor-pointer text-sm font-bold text-[#a2ffd5]">
							Review recent hidden recommendations ({graph.hiddenItems.length}{' '}
							of {graph.summary.hiddenCount})
						</summary>
						<ul className="mt-3 divide-y divide-[#54806c]/40">
							{graph.hiddenItems.map(item => (
								<li
									key={item.id}
									className="flex items-center justify-between gap-3 py-2 text-sm text-[#ffefcc]"
								>
									<span>{item.title}</span>
									<RestoreRecommendationControl
										mediaId={item.id}
										title={item.title}
									/>
								</li>
							))}
						</ul>
					</details>
				) : null}
			</section>
		)
	}

	return (
		<section
			className="space-y-7 rounded-3xl border border-[#54806c]/70 bg-[#242525]/70 p-4 shadow-xl shadow-black/10 sm:p-6"
			aria-labelledby="recommendation-lanes-heading"
		>
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffcc66]">
						Explainable, private ranking
					</p>
					<h2
						id="recommendation-lanes-heading"
						className="mt-1 text-2xl font-black text-[#ffffb1]"
					>
						Recommendations for you
					</h2>
					<p className="mt-2 max-w-3xl text-sm leading-6 text-[#c6ded2]">
						Separate lanes preserve why each title surfaced. Feedback affects
						only your recommendations and never changes community scores.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-xs text-[#a2ffd5]">
					<span className="rounded-full bg-[#315746] px-3 py-1.5">
						{graph.summary.positiveSeeds} taste signals
					</span>
					{graph.summary.followingCount ? (
						<span className="rounded-full bg-[#383040] px-3 py-1.5">
							{graph.summary.followingCount} followed
						</span>
					) : null}
				</div>
			</header>

			{graph.lanes.map(lane => (
				<section
					key={lane.key}
					className="space-y-3"
					aria-labelledby={`recommendation-lane-${lane.key}`}
				>
					<header>
						<h3
							id={`recommendation-lane-${lane.key}`}
							className="text-xl font-black text-[#ffffb1]"
						>
							{lane.title}
						</h3>
						<p className="mt-1 text-sm text-[#a2ffd5]">{lane.description}</p>
					</header>
					<div
						className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-[#a2ffd5] [&::-webkit-scrollbar]:hidden"
						role="region"
						aria-label={`${lane.title} titles`}
						tabIndex={0}
					>
						{lane.items.map(item => {
							const poster = splitLegacyThumbnail(item.thumbnail).imageUrl
							return (
								<article
									key={item.id}
									className="flex w-[15rem] min-w-[15rem] snap-start flex-col overflow-hidden rounded-2xl border border-[#54806c] bg-[#383040] shadow-lg shadow-black/10"
								>
									<Link to={`/media/${item.id}`} className="group block">
										<div className="aspect-[2/3] overflow-hidden bg-[#2e2f2b]">
											{poster ? (
												<img
													src={poster}
													alt=""
													loading="lazy"
													className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
												/>
											) : (
												<div className="flex h-full items-center justify-center px-5 text-center text-sm font-semibold text-[#8ca99d]">
													No poster available
												</div>
											)}
										</div>
										<div className="p-3">
											<p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#a2ffd5]">
												{item.type || item.kind}
												{item.year ? ` · ${item.year}` : ''}
											</p>
											<h4 className="mt-1 line-clamp-2 font-black leading-5 text-[#ffffb1] group-hover:underline">
												{item.title}
											</h4>
										</div>
									</Link>
									<div className="flex flex-1 flex-col gap-3 border-t border-[#54806c]/60 p-3">
										<div
											className="space-y-1.5 text-xs leading-5 text-[#d7e9df]"
											aria-label={`Why ${item.title} was recommended`}
										>
											{item.reasons.map(reason => (
												<p key={reason} className="flex gap-2">
													<span aria-hidden="true" className="text-[#ffcc66]">
														●
													</span>
													<span>{reason}</span>
												</p>
											))}
										</div>
										<div className="mt-auto space-y-2">
											<QuickTrackControl
												item={item}
												watchlists={watchlists}
												isSignedIn
												loginRedirectTo={loginRedirectTo}
												layout="stacked"
											/>
											<RecommendationFeedbackControl
												mediaId={item.id}
												title={item.title}
												lane={lane.key}
											/>
										</div>
									</div>
								</article>
							)
						})}
					</div>
				</section>
			))}

			{graph.hiddenItems.length ? (
				<details className="rounded-xl border border-[#54806c]/60 bg-[#2e2f2b] p-3">
					<summary className="cursor-pointer text-sm font-bold text-[#a2ffd5]">
						Review recent hidden recommendations ({graph.hiddenItems.length} of{' '}
						{graph.summary.hiddenCount})
					</summary>
					<ul className="mt-3 divide-y divide-[#54806c]/40">
						{graph.hiddenItems.map(item => (
							<li
								key={item.id}
								className="flex items-center justify-between gap-3 py-2 text-sm text-[#ffefcc]"
							>
								<span>{item.title}</span>
								<RestoreRecommendationControl
									mediaId={item.id}
									title={item.title}
								/>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</section>
	)
}
