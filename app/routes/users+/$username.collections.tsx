import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	Link,
	type LoaderFunctionArgs,
	useLoaderData,
} from 'react-router'
import { MediaCollectionCard } from '#app/components/media-collection-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const user = await prisma.user.findUnique({
		where: { username: params.username },
		select: { id: true, username: true, name: true },
	})
	invariantResponse(user, 'User not found', { status: 404 })
	const isOwner = viewerId === user.id
	const collections = await prisma.mediaCollection.findMany({
		where: { ownerId: user.id, ...(isOwner ? {} : { isPublic: true }) },
		orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
		select: {
			id: true,
			title: true,
			description: true,
			isPublic: true,
			updatedAt: true,
			owner: { select: { username: true, name: true } },
			_count: { select: { items: true } },
			items: {
				orderBy: [{ position: 'asc' }, { id: 'asc' }],
				take: 4,
				select: {
					media: { select: { id: true, title: true, thumbnail: true } },
				},
			},
		},
	})
	return json({ user, collections, isOwner })
}

export default function ProfileCollections() {
	const data = useLoaderData<typeof loader>()
	return (
		<section className="mx-auto max-w-6xl space-y-5 text-[#ffefcc]">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h2 className="text-2xl font-black text-[#ffffb1]">Collections</h2>
					<p className="mt-1 text-sm text-[#a2ffd5]">
						{data.collections.length} curated{' '}
						{data.collections.length === 1 ? 'list' : 'lists'}
					</p>
				</div>
				{data.isOwner ? (
					<Button asChild>
						<Link to="/collections/new">Create a collection</Link>
					</Button>
				) : null}
			</header>
			{data.collections.length ? (
				<div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
					{data.collections.map(collection => (
						<MediaCollectionCard
							key={collection.id}
							collection={collection}
							showOwner={false}
						/>
					))}
				</div>
			) : (
				<div className="rounded-2xl border border-dashed border-[#54806c] bg-[#383040] px-6 py-14 text-center">
					<h3 className="text-xl font-black text-[#ffffb1]">
						No collections yet
					</h3>
					<p className="mt-2 text-[#a2ffd5]">
						{data.isOwner
							? 'Curate your first themed or ranked list.'
							: `${data.user.name ?? data.user.username} has not published a collection.`}
					</p>
				</div>
			)}
		</section>
	)
}
