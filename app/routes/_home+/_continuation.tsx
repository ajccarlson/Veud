import { Link } from 'react-router'
import { type getContinuationQueue } from '#app/utils/home-dashboard.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

type ContinuationItem = Awaited<ReturnType<typeof getContinuationQueue>>[number]

function progressLabel(item: ContinuationItem) {
	if (!item.progress.length) return 'No progress logged yet'
	return item.progress
		.map(progress => {
			const unit = progress.unit.toLowerCase()
			const label = unit.charAt(0).toUpperCase() + unit.slice(1)
			return `${label} ${progress.current}${progress.total ? ` of ${progress.total}` : ''}`
		})
		.join(' · ')
}

export function HomeContinuation({ items }: { items: ContinuationItem[] }) {
	return (
		<div className="home-continuation space-y-4">
			<header>
				<p className="text-xs font-black uppercase tracking-[0.18em] text-[#a2ffd5]">
					Pick up where you left off
				</p>
				<h2 className="text-2xl font-black text-[#ff9900]">Continue</h2>
			</header>
			{items.length ? (
				<div className="home-continuation-grid">
					{items.map(item => {
						const poster = splitLegacyThumbnail(item.media.thumbnail).imageUrl
						return (
							<Link
								key={item.id}
								to={`/media/${item.media.id}`}
								className="home-continuation-card"
							>
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
									<p className="text-[0.68rem] font-bold uppercase tracking-wide text-[#a2ffd5]">
										{item.media.type || item.media.kind}
									</p>
									<h3 className="line-clamp-2 font-black text-[#ffffb1]">
										{item.media.title || 'Untitled'}
									</h3>
									<p className="mt-2 line-clamp-2 text-xs text-[#c6ded2]">
										{progressLabel(item)}
									</p>
								</div>
							</Link>
						)
					})}
				</div>
			) : (
				<div className="home-dashboard-empty">
					Start watching or reading a title and it will appear here.
				</div>
			)}
		</div>
	)
}
