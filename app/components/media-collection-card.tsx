import { Link } from 'react-router'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

type CollectionCardData = {
	id: string
	title: string
	description: string | null
	isPublic: boolean
	featuredAt: Date | string | null
	updatedAt: Date | string
	owner: { username: string }
	_count: { items: number; likes: number; comments: number }
	tags: Array<{ tag: { name: string; slug: string } }>
	items: Array<{
		media: { id: string; title: string | null; thumbnail: string | null }
	}>
	recommendationReason?: string | null
}

export function MediaCollectionCard({
	collection,
	showOwner = true,
}: {
	collection: CollectionCardData
	showOwner?: boolean
}) {
	return (
		<article className="overflow-hidden rounded-2xl border border-[rgb(var(--veud-rule))] bg-[rgb(var(--veud-panel-violet))] transition hover:-translate-y-1 hover:border-[rgb(var(--veud-accent-bright))] hover:shadow-xl">
			<Link to={`/collections/${collection.id}`} className="block">
				<div className="grid aspect-[2/1] grid-cols-4 overflow-hidden bg-[rgb(var(--veud-panel))]">
					{Array.from({ length: 4 }, (_, index) => {
						const item = collection.items[index]
						const poster = splitLegacyThumbnail(item?.media.thumbnail).imageUrl
						return poster ? (
							<img
								key={item?.media.id ?? index}
								src={poster}
								alt=""
								loading="lazy"
								className="h-full w-full object-cover"
							/>
						) : (
							<div
								key={item?.media.id ?? index}
								className="border-r border-[rgb(var(--veud-rule))]/40 last:border-r-0"
							/>
						)
					})}
				</div>
				<div className="space-y-3 p-5">
					{collection.recommendationReason ? (
						<p className="rounded-lg border border-[rgb(var(--veud-accent-bright))]/50 bg-[rgb(var(--veud-panel))] px-3 py-2 text-xs font-bold text-[rgb(var(--veud-accent-bright))]">
							Why this list: {collection.recommendationReason}
						</p>
					) : null}
					<div>
						<div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-[rgb(var(--veud-accent-bright))]">
							<span>
								{collection._count.items}{' '}
								{collection._count.items === 1 ? 'title' : 'titles'}
							</span>
							<span>· {collection._count.likes} likes</span>
							<span>· {collection._count.comments} comments</span>
							{!collection.isPublic ? (
								<span className="rounded-full border border-[rgb(var(--veud-gold-bright))] px-2 py-0.5 text-[rgb(var(--veud-gold-bright))]">
									Private
								</span>
							) : null}
							{collection.featuredAt ? (
								<span className="rounded-full border border-[rgb(var(--veud-signal))] px-2 py-0.5 text-[rgb(var(--veud-highlight))]">
									Staff pick
								</span>
							) : null}
						</div>
						<h2 className="mt-1 text-xl font-black text-[rgb(var(--veud-highlight))] hover:underline">
							{collection.title}
						</h2>
					</div>
					{collection.description ? (
						<p className="line-clamp-2 text-sm leading-6 text-[rgb(var(--veud-body-text))]">
							{collection.description}
						</p>
					) : null}
					{collection.tags.length ? (
						<div className="flex flex-wrap gap-1.5">
							{collection.tags.map(({ tag }) => (
								<span
									key={tag.slug}
									className="rounded-full border border-[rgb(var(--veud-rule))] px-2 py-0.5 text-xs font-bold text-[rgb(var(--veud-accent-bright))]"
								>
									#{tag.name}
								</span>
							))}
						</div>
					) : null}
					{showOwner ? (
						<p className="text-sm text-[rgb(var(--veud-accent-bright))]">
							by {collection.owner.username}
						</p>
					) : null}
				</div>
			</Link>
		</article>
	)
}
