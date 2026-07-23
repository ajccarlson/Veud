import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	Link,
	type LoaderFunctionArgs,
	useLoaderData,
} from 'react-router'
import { MediaCollectionCard } from '#app/components/media-collection-card.tsx'
import {
	ProfileEmptyState,
	ProfilePageHeader,
} from '#app/components/profile-ui.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export { ProfileTabErrorBoundary as ErrorBoundary } from '#app/components/profile-ui.tsx'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const user = await prisma.user.findUnique({
		where: { username: params.username },
		select: { id: true, username: true, name: true },
	})
	invariantResponse(user, 'User not found', { status: 404 })
	const isOwner = viewerId === user.id
	const collections = await prisma.mediaCollection.findMany({
		where: {
			ownerId: user.id,
			...(isOwner
				? {}
				: { isPublic: true, moderationStatus: 'visible' }),
		},
		orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
		select: {
			id: true,
			title: true,
			description: true,
			isPublic: true,
			featuredAt: true,
			updatedAt: true,
			owner: { select: { username: true, name: true } },
			_count: {
				select: {
					items: true,
					likes: true,
					comments: { where: { moderationStatus: 'visible' } },
				},
			},
			tags: {
				orderBy: { tag: { name: 'asc' } },
				select: { tag: { select: { name: true, slug: true } } },
			},
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
		<section className="user-landing-collections">
			<ProfilePageHeader
				eyebrow="Member curation"
				title="Collections"
				description="Themed, ranked, and hand-picked groups of titles."
				meta={`${data.collections.length} curated ${data.collections.length === 1 ? 'list' : 'lists'}`}
				action={
					data.isOwner ? (
						<Button asChild>
							<Link to="/collections/new">Create a collection</Link>
						</Button>
					) : null
				}
			/>
			{data.collections.length ? (
				<div className="user-landing-collections-grid">
					{data.collections.map(collection => (
						<MediaCollectionCard
							key={collection.id}
							collection={collection}
							showOwner={false}
						/>
					))}
				</div>
			) : (
				<ProfileEmptyState
					icon="archive"
					title="Start the first curated list"
					description={
						data.isOwner
							? 'Curate your first themed or ranked list.'
							: `${data.user.name ?? data.user.username} has not published a collection.`
					}
				/>
			)}
		</section>
	)
}
