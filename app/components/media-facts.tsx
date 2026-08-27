import { type MediaFact } from '#app/utils/media-facts.ts'
import { type MediaVideoLink } from '#app/utils/media-videos.ts'

export function MediaFacts({ facts }: { facts: MediaFact[] }) {
	if (!facts.length) return null
	return (
		<section
			aria-labelledby="media-facts-heading"
			className="rounded-xl border bg-card p-4"
		>
			<h2 id="media-facts-heading" className="text-lg font-bold">
				Facts
			</h2>
			<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-1">
				{facts.map(fact => (
					<div key={fact.label} className="min-w-0">
						<dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							{fact.label}
						</dt>
						<dd className="mt-0.5 break-words text-sm font-medium">
							{fact.value}
						</dd>
					</div>
				))}
			</dl>
		</section>
	)
}

export function MediaVideos({ videos }: { videos: MediaVideoLink[] }) {
	if (!videos.length) return null
	return (
		<section className="space-y-4" aria-labelledby="media-videos-heading">
			<h2 id="media-videos-heading" className="text-2xl font-bold">
				Videos
			</h2>
			<ul
				aria-label="Videos"
				className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				{videos.map(video => (
					<li
						key={`${video.provider}:${video.site}:${video.key}`}
						className="w-[min(19rem,82vw)] shrink-0 snap-start"
					>
						<a
							href={video.url}
							target="_blank"
							rel="noreferrer"
							className="group block overflow-hidden rounded-xl border bg-card transition hover:border-primary/60 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
						>
							<div className="aspect-video overflow-hidden bg-gradient-to-br from-primary/25 via-muted to-background">
								{video.thumbnailUrl ? (
									<img
										src={video.thumbnailUrl}
										alt=""
										loading="lazy"
										className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
									/>
								) : (
									<div className="flex h-full items-center justify-center text-3xl text-primary">
										▶
									</div>
								)}
							</div>
							<div className="p-4">
								<h3 className="line-clamp-2 font-bold leading-5 group-hover:underline">
									{video.name}
								</h3>
								<p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									{video.type} · {video.site}
								</p>
							</div>
						</a>
					</li>
				))}
			</ul>
		</section>
	)
}
