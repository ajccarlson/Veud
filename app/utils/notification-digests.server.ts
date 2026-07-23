import { prisma } from './db.server.ts'
import { sendEmail } from './email.server.ts'
import {
	isReleaseNotificationType,
	nextNotificationDigestAt,
} from './notification-preferences.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const CLAIM_TIMEOUT_MS = 30 * 60 * 1_000

type EmailSender = typeof sendEmail

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;')
}

function itemCopy(item: {
	type: string
	actor: { username: string; name: string | null } | null
	review: { id: string; media: { id: string; title: string | null } } | null
	collection: { id: string; title: string } | null
	releaseReminder: {
		media: { id: string; title: string | null; kind: string }
	} | null
}) {
	if (item.releaseReminder) {
		const media = item.releaseReminder.media
		return {
			copy: `${media.title?.trim() || `Untitled ${media.kind}`} has a release reminder`,
			path: `/media/${media.id}`,
		}
	}
	const actor = item.actor?.name?.trim() || item.actor?.username || 'A member'
	if (item.collection) {
		return {
			copy: `${actor} ${item.type === 'collection_like' ? 'liked' : 'commented on'} ${item.collection.title}`,
			path: `/collections/${item.collection.id}`,
		}
	}
	if (item.review) {
		const action =
			item.type === 'review_like'
				? 'liked your review of'
				: item.type === 'review_reply'
					? 'replied on'
					: 'commented on your review of'
		return {
			copy: `${actor} ${action} ${item.review.media.title?.trim() || 'an untitled work'}`,
			path: `/media/${item.review.media.id}#review-${item.review.id}`,
		}
	}
	return null
}

export async function processDueNotificationDigests({
	now = new Date(),
	commit = false,
	limit = 50,
	send = sendEmail,
}: {
	now?: Date
	commit?: boolean
	limit?: number
	send?: EmailSender
} = {}) {
	const preferences = await prisma.notificationPreference.findMany({
		where: {
			nextDigestAt: { lte: now },
			digestFrequency: { in: ['daily', 'weekly'] },
			OR: [{ emailSocial: true }, { emailReleases: true }],
		},
		orderBy: [{ nextDigestAt: 'asc' }, { ownerId: 'asc' }],
		take: Math.max(1, Math.min(limit, 500)),
		include: { owner: { select: { email: true, username: true } } },
	})
	const outcomes: Array<{
		ownerId: string
		status: 'preview' | 'sent' | 'empty' | 'skipped' | 'failed'
		itemCount: number
	}> = []

	for (const preference of preferences) {
		const windowEnd = preference.nextDigestAt!
		const latest = await prisma.notificationDigest.findFirst({
			where: { ownerId: preference.ownerId, status: { in: ['sent', 'empty'] } },
			orderBy: { windowEnd: 'desc' },
			select: { windowEnd: true },
		})
		const windowStart =
			latest?.windowEnd ??
			new Date(
				windowEnd.getTime() -
					(preference.digestFrequency === 'weekly' ? 7 : 1) * DAY_MS,
			)
		const categoryWhere =
			preference.emailSocial && preference.emailReleases
				? {}
				: preference.emailReleases
					? { type: 'release_reminder' }
					: { type: { not: 'release_reminder' } }
		const where = {
			recipientId: preference.ownerId,
			availableAt: { gt: windowStart, lte: windowEnd },
			...categoryWhere,
		}
		const [itemCount, items] = await Promise.all([
			prisma.notification.count({ where }),
			prisma.notification.findMany({
				where,
				orderBy: [{ availableAt: 'desc' }, { id: 'desc' }],
				take: 20,
				select: {
					type: true,
					actor: { select: { username: true, name: true } },
					review: {
						select: {
							id: true,
							media: { select: { id: true, title: true } },
						},
					},
					collection: { select: { id: true, title: true } },
					releaseReminder: {
						select: {
							media: { select: { id: true, title: true, kind: true } },
						},
					},
				},
			}),
		])
		if (!commit) {
			outcomes.push({ ownerId: preference.ownerId, status: 'preview', itemCount })
			continue
		}

		const delivery = await prisma.notificationDigest.upsert({
			where: {
				ownerId_windowStart_windowEnd: {
					ownerId: preference.ownerId,
					windowStart,
					windowEnd,
				},
			},
			create: {
				ownerId: preference.ownerId,
				frequency: preference.digestFrequency,
				windowStart,
				windowEnd,
				itemCount,
			},
			update: {},
			select: { id: true, status: true },
		})
		const nextDigestAt = nextNotificationDigestAt(
			{
				...preference,
				digestFrequency:
					preference.digestFrequency === 'weekly' ? 'weekly' : 'daily',
			},
			new Date(windowEnd.getTime() + 1_000),
		)
		if (delivery.status === 'sent' || delivery.status === 'empty') {
			await prisma.notificationPreference.updateMany({
				where: {
					id: preference.id,
					nextDigestAt: { lte: windowEnd },
				},
				data: { nextDigestAt },
			})
			outcomes.push({
				ownerId: preference.ownerId,
				status: 'skipped',
				itemCount,
			})
			continue
		}
		if (!itemCount) {
			await prisma.$transaction([
				prisma.notificationDigest.update({
					where: { id: delivery.id },
					data: { status: 'empty', error: null },
				}),
				prisma.notificationPreference.update({
					where: { id: preference.id },
					data: { nextDigestAt },
				}),
			])
			outcomes.push({ ownerId: preference.ownerId, status: 'empty', itemCount })
			continue
		}
		const claimed = await prisma.notificationDigest.updateMany({
			where: {
				id: delivery.id,
				OR: [
					{ status: { in: ['pending', 'failed'] } },
					{
						status: 'sending',
						updatedAt: {
							lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS),
						},
					},
				],
			},
			data: { status: 'sending', error: null },
		})
		if (!claimed.count) {
			outcomes.push({
				ownerId: preference.ownerId,
				status: 'skipped',
				itemCount,
			})
			continue
		}

		const origin = (process.env.VEUD_ORIGIN || 'https://veud.net').replace(/\/$/, '')
		const entries = items.flatMap(item => {
			const copy = itemCopy(item)
			return copy ? [{ ...copy, url: `${origin}${copy.path}` }] : []
		})
		const remaining = Math.max(0, itemCount - entries.length)
		const text = [
			`Hi ${preference.owner.username},`,
			'',
			`You have ${itemCount} new Veud notification${itemCount === 1 ? '' : 's'}.`,
			'',
			...entries.map(entry => `• ${entry.copy}\n  ${entry.url}`),
			...(remaining ? [`\n…and ${remaining} more in your Veud inbox.`] : []),
			'',
			`Manage preferences: ${origin}/settings/profile/notifications`,
		].join('\n')
		const html = [
			`<p>Hi ${escapeHtml(preference.owner.username)},</p>`,
			`<p>You have ${itemCount} new Veud notification${itemCount === 1 ? '' : 's'}.</p>`,
			'<ul>',
			...entries.map(
				entry =>
					`<li><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.copy)}</a></li>`,
			),
			'</ul>',
			remaining ? `<p>…and ${remaining} more in your Veud inbox.</p>` : '',
			`<p><a href="${escapeHtml(origin)}/settings/profile/notifications">Manage notification preferences</a></p>`,
		].join('')
		let result: Awaited<ReturnType<EmailSender>>
		try {
			result = await send({
				to: preference.owner.email,
				subject: `${itemCount} new Veud notification${itemCount === 1 ? '' : 's'}`,
				html,
				text,
			})
		} catch (error) {
			await prisma.notificationDigest.update({
				where: { id: delivery.id },
				data: {
					status: 'failed',
					error: (
						error instanceof Error
							? error.message
							: 'Notification email transport failed'
					).slice(0, 500),
				},
			})
			outcomes.push({
				ownerId: preference.ownerId,
				status: 'failed',
				itemCount,
			})
			continue
		}
		if (result.status === 'success') {
			await prisma.$transaction([
				prisma.notificationDigest.update({
					where: { id: delivery.id },
					data: {
						status: 'sent',
						sentAt: now,
						providerMessageId: result.data.id,
					},
				}),
				prisma.notificationPreference.update({
					where: { id: preference.id },
					data: { nextDigestAt },
				}),
			])
			outcomes.push({ ownerId: preference.ownerId, status: 'sent', itemCount })
		} else {
			await prisma.notificationDigest.update({
				where: { id: delivery.id },
				data: {
					status: 'failed',
					error: result.error.message.slice(0, 500),
				},
			})
			outcomes.push({ ownerId: preference.ownerId, status: 'failed', itemCount })
		}
	}
	return outcomes
}

export function notificationMatchesDigestCategories(
	type: string,
	preference: { emailSocial: boolean; emailReleases: boolean },
) {
	return isReleaseNotificationType(type)
		? preference.emailReleases
		: preference.emailSocial
}
