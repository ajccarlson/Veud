import {
	data as json,
	Form,
	Link,
	redirect,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	useLoaderData,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	getNotificationPreferences,
	notificationInboxWhere,
} from '#app/utils/notification-preferences.server.ts'
import { syncReleaseRemindersForUser } from '#app/utils/release-reminders.server.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const now = new Date()
	const [, preferences] = await Promise.all([
		syncReleaseRemindersForUser(prisma, userId, now),
		getNotificationPreferences(userId),
	])
	const notifications = await prisma.notification.findMany({
		where: {
			recipientId: userId,
			availableAt: { lte: now },
			...notificationInboxWhere(preferences),
		},
		orderBy: [{ availableAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
		take: 50,
		select: {
			id: true,
			type: true,
			message: true,
			readAt: true,
			availableAt: true,
			releaseAt: true,
			createdAt: true,
			reviewCommentId: true,
			collectionCommentId: true,
			actor: { select: { username: true, name: true } },
			review: {
				select: {
					id: true,
					media: { select: { id: true, title: true, kind: true } },
				},
			},
			collection: { select: { id: true, title: true } },
			releaseReminder: {
				select: {
					media: { select: { id: true, title: true, kind: true } },
				},
			},
		},
	})
	return json({
		notifications,
		unreadCount: notifications.filter(notification => !notification.readAt)
			.length,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'read-all') {
		const now = new Date()
		const preferences = await getNotificationPreferences(userId)
		await prisma.notification.updateMany({
			where: {
				recipientId: userId,
				readAt: null,
				availableAt: { lte: now },
				...notificationInboxWhere(preferences),
			},
			data: { readAt: now },
		})
		return json({ ok: true })
	}

	if (intent === 'read') {
		const notificationId = formData.get('notificationId')
		if (typeof notificationId !== 'string' || !notificationId) {
			throw new Response('Missing notification', { status: 400 })
		}
		const preferences = await getNotificationPreferences(userId)
		const notification = await prisma.notification.findFirst({
			where: {
				id: notificationId,
				recipientId: userId,
				availableAt: { lte: new Date() },
				...notificationInboxWhere(preferences),
			},
			select: {
				id: true,
				type: true,
				reviewCommentId: true,
				collectionCommentId: true,
				review: { select: { id: true, mediaId: true } },
				collection: { select: { id: true } },
				releaseReminder: { select: { mediaId: true } },
			},
		})
		if (!notification) {
			throw new Response('Notification not found', { status: 404 })
		}
		await prisma.notification.update({
			where: { id: notification.id },
			data: { readAt: new Date() },
		})
		if (notification.type === 'moderation_notice') {
			return redirect('/settings/profile')
		}
		if (notification.collection) {
			const anchor = notification.collectionCommentId
				? `collection-comment-${notification.collectionCommentId}`
				: 'discussion'
			return redirect(`/collections/${notification.collection.id}#${anchor}`)
		}
		if (notification.review) {
			const anchor = notification.reviewCommentId
				? `comment-${notification.reviewCommentId}`
				: `review-${notification.review.id}`
			return redirect(`/media/${notification.review.mediaId}#${anchor}`)
		}
		if (notification.releaseReminder) {
			return redirect(`/media/${notification.releaseReminder.mediaId}`)
		}
		throw new Response('Notification target not found', { status: 404 })
	}

	throw new Response('Invalid notification action', { status: 400 })
}

function notificationAction(type: string) {
	if (type === 'review_like') return 'liked your review of'
	if (type === 'review_reply') return 'replied to your comment on'
	if (type === 'collection_like') return 'liked your collection'
	if (type === 'collection_comment') return 'commented on your collection'
	return 'commented on your review of'
}

function displayTime(value: Date | string) {
	return new Date(value).toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	})
}

export default function NotificationsRoute() {
	const data = useLoaderData<typeof loader>()
	return (
		<VeudPage width="form">
			<VeudPageHeader
				eyebrow="Your signal desk"
				title="Notifications"
				description="Release reminders, likes, and discussion on your activity."
				actions={
					<div className="flex flex-wrap gap-2">
						<Button asChild variant="ghost" size="sm">
							<Link to="/settings/profile/notifications">Preferences</Link>
						</Button>
						{data.unreadCount ? (
							<Form method="post">
								<input type="hidden" name="intent" value="read-all" />
								<Button type="submit" variant="outline" size="sm">
									Mark all read
								</Button>
							</Form>
						) : null}
					</div>
				}
			/>

			{data.notifications.length ? (
				<VeudPanel className="overflow-hidden p-0">
					<ul className="divide-y divide-veud-border/60">
						{data.notifications.map(notification => {
							if (
								notification.type === 'moderation_notice' &&
								notification.message
							) {
								const copy = (
									<>
										<span className="font-semibold">Moderation notice:</span>{' '}
										{notification.message}
									</>
								)
								return (
									<li
										key={notification.id}
										className={
											notification.readAt
												? 'p-4 sm:p-5'
												: 'border-l-2 border-veud-gold bg-veud-gold/10 p-4 sm:p-5'
										}
									>
										{notification.readAt ? (
											<Link
												to="/settings/profile"
												className="block hover:underline"
											>
												{copy}
											</Link>
										) : (
											<Form method="post">
												<input type="hidden" name="intent" value="read" />
												<input
													type="hidden"
													name="notificationId"
													value={notification.id}
												/>
												<button
													type="submit"
													className="w-full text-left hover:underline"
												>
													{copy}
												</button>
											</Form>
										)}
										<time className="mt-2 block text-xs font-semibold text-veud-sage">
											{displayTime(notification.availableAt)}
										</time>
									</li>
								)
							}
							const collection = notification.collection
							const review = notification.review
							const releaseMedia = notification.releaseReminder?.media
							if (!collection && !review && !releaseMedia) return null
							const releaseSubject = releaseMedia
								? releaseMedia.title?.trim() || `Untitled ${releaseMedia.kind}`
								: null
							const subject = collection
								? collection.title
								: review?.media.title?.trim() ||
									`Untitled ${review?.media.kind ?? 'media'}`
							const copy = releaseMedia ? (
								<>
									<span className="font-semibold">{releaseSubject}</span> is
									coming up
									{notification.releaseAt
										? ` · ${displayTime(notification.releaseAt)}`
										: ''}
									.
								</>
							) : (
								<>
									<span className="font-semibold">
										{notification.actor?.username}
									</span>{' '}
									{notificationAction(notification.type)}{' '}
									<span className="font-semibold">{subject}</span>
								</>
							)
							const href = releaseMedia
								? `/media/${releaseMedia.id}`
								: collection
									? `/collections/${collection.id}#${
											notification.collectionCommentId
												? `collection-comment-${notification.collectionCommentId}`
												: 'discussion'
										}`
									: `/media/${review!.media.id}#${
											notification.reviewCommentId
												? `comment-${notification.reviewCommentId}`
												: `review-${review!.id}`
										}`
							return (
								<li
									key={notification.id}
									className={
										notification.readAt
											? 'p-4 sm:p-5'
											: 'border-l-2 border-veud-mint bg-veud-mint/10 p-4 sm:p-5'
									}
								>
									{notification.readAt ? (
										<Link to={href} className="block hover:underline">
											{copy}
										</Link>
									) : (
										<Form method="post">
											<input type="hidden" name="intent" value="read" />
											<input
												type="hidden"
												name="notificationId"
												value={notification.id}
											/>
											<button
												type="submit"
												className="w-full text-left hover:underline"
											>
												{copy}
											</button>
										</Form>
									)}
									<time className="mt-2 block text-xs font-semibold text-veud-sage">
										{displayTime(notification.availableAt)}
									</time>
								</li>
							)
						})}
					</ul>
				</VeudPanel>
			) : (
				<VeudEmptyState title="Your inbox is clear">
					New reminders and community activity will collect here.
				</VeudEmptyState>
			)}
		</VeudPage>
	)
}
