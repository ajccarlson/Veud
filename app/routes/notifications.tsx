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
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const notifications = await prisma.notification.findMany({
		where: { recipientId: userId },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		take: 50,
		select: {
			id: true,
			type: true,
			readAt: true,
			createdAt: true,
			reviewCommentId: true,
			actor: { select: { username: true, name: true } },
			review: {
				select: {
					id: true,
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
		await prisma.notification.updateMany({
			where: { recipientId: userId, readAt: null },
			data: { readAt: new Date() },
		})
		return json({ ok: true })
	}

	if (intent === 'read') {
		const notificationId = formData.get('notificationId')
		if (typeof notificationId !== 'string' || !notificationId) {
			throw new Response('Missing notification', { status: 400 })
		}
		const notification = await prisma.notification.findFirst({
			where: { id: notificationId, recipientId: userId },
			select: {
				id: true,
				reviewCommentId: true,
				review: { select: { id: true, mediaId: true } },
			},
		})
		if (!notification) {
			throw new Response('Notification not found', { status: 404 })
		}
		await prisma.notification.update({
			where: { id: notification.id },
			data: { readAt: new Date() },
		})
		const anchor = notification.reviewCommentId
			? `comment-${notification.reviewCommentId}`
			: `review-${notification.review.id}`
		return redirect(`/media/${notification.review.mediaId}#${anchor}`)
	}

	throw new Response('Invalid notification action', { status: 400 })
}

function notificationAction(type: string) {
	if (type === 'review_like') return 'liked your review of'
	if (type === 'review_reply') return 'replied to your comment on'
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
		<main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-3xl font-black">Notifications</h1>
					<p className="text-sm text-muted-foreground">
						Likes and discussion on your reviews.
					</p>
				</div>
				{data.unreadCount ? (
					<Form method="post">
						<input type="hidden" name="intent" value="read-all" />
						<Button type="submit" variant="outline" size="sm">
							Mark all read
						</Button>
					</Form>
				) : null}
			</header>

			{data.notifications.length ? (
				<ul className="divide-y overflow-hidden rounded-xl border bg-card">
					{data.notifications.map(notification => {
						const copy = (
							<>
								<span className="font-semibold">
									{notification.actor.name ?? notification.actor.username}
								</span>{' '}
								{notificationAction(notification.type)}{' '}
								<span className="font-semibold">
									{notification.review.media.title?.trim() ||
										`Untitled ${notification.review.media.kind}`}
								</span>
							</>
						)
						const anchor = notification.reviewCommentId
							? `comment-${notification.reviewCommentId}`
							: `review-${notification.review.id}`
						return (
							<li
								key={notification.id}
								className={notification.readAt ? 'p-4' : 'bg-primary/5 p-4'}
							>
								{notification.readAt ? (
									<Link
										to={`/media/${notification.review.media.id}#${anchor}`}
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
								<time className="mt-1 block text-xs text-muted-foreground">
									{displayTime(notification.createdAt)}
								</time>
							</li>
						)
					})}
				</ul>
			) : (
				<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
					No notifications yet.
				</div>
			)}
		</main>
	)
}
