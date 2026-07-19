import { Link } from 'react-router'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

type CollectionCardData = {
	id: string
	title: string
	description: string | null
	isPublic: boolean
	updatedAt: Date | string
	owner: { username: string; name: string | null }
	_count: { items: number; likes: number; comments: number }
	items: Array<{
		media: { id: string; title: string | null; thumbnail: string | null }
	}>
}

export function MediaCollectionCard({
	collection,
	showOwner = true,
}: {
	collection: CollectionCardData
	showOwner?: boolean
}) {
	return (
		<article className="overflow-hidden rounded-2xl border border-[#54806c] bg-[#383040] transition hover:-translate-y-1 hover:border-[#a2ffd5] hover:shadow-xl">
			<Link to={`/collections/${collection.id}`} className="block">
				<div className="grid aspect-[2/1] grid-cols-4 overflow-hidden bg-[#2e2f2b]">
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
								className="border-r border-[#54806c]/40 last:border-r-0"
							/>
						)
					})}
				</div>
				<div className="space-y-3 p-5">
					<div>
						<div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#a2ffd5]">
							<span>
								{collection._count.items}{' '}
								{collection._count.items === 1 ? 'title' : 'titles'}
							</span>
							<span>· {collection._count.likes} likes</span>
							<span>· {collection._count.comments} comments</span>
							{!collection.isPublic ? (
								<span className="rounded-full border border-[#ffcc66] px-2 py-0.5 text-[#ffcc66]">
									Private
								</span>
							) : null}
						</div>
						<h2 className="mt-1 text-xl font-black text-[#ffffb1] hover:underline">
							{collection.title}
						</h2>
					</div>
					{collection.description ? (
						<p className="line-clamp-2 text-sm leading-6 text-[#c6ded2]">
							{collection.description}
						</p>
					) : null}
					{showOwner ? (
						<p className="text-sm text-[#a2ffd5]">
							by {collection.owner.name ?? collection.owner.username}
						</p>
					) : null}
				</div>
			</Link>
		</article>
	)
}
