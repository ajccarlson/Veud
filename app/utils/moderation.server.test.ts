import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from './auth.server.ts'
import { prisma } from './db.server.ts'
import {
	createModerationReport,
	createModerationAppeal,
	moderateAccount,
	moderateContent,
	setModeratorRole,
	updateReportWorkflow,
} from './moderation.server.ts'

async function createUser(prefix: string, role?: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	if (role) {
		await prisma.role.upsert({
			where: { name: role },
			create: { name: role },
			update: {},
		})
	}
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			roles: role ? { connect: { name: role } } : undefined,
		},
	})
}

async function rejectionStatus(promise: Promise<unknown>) {
	const error = await promise.catch(reason => reason)
	expect(error).toBeInstanceOf(Response)
	return (error as Response).status
}

test('reports are private, deduplicated, prioritized, and cannot target the reporter', async () => {
	const [reporter, author] = await Promise.all([
		createUser('reporter'),
		createUser('author'),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Moderation test' },
	})
	const review = await prisma.review.create({
		data: {
			authorId: author.id,
			mediaId: media.id,
			body: 'A reportable review.',
		},
	})

	const first = await prisma.$transaction(tx =>
		createModerationReport(tx, {
			reporterId: reporter.id,
			targetType: 'review',
			targetId: review.id,
			reasonCategory: 'privacy',
			details: 'Contains a private address.',
		}),
	)
	const duplicate = await prisma.$transaction(tx =>
		createModerationReport(tx, {
			reporterId: reporter.id,
			targetType: 'review',
			targetId: review.id,
			reasonCategory: 'spam',
			details: '',
		}),
	)

	expect(duplicate).toEqual({ id: first.id, duplicate: true })
	expect(
		await prisma.moderationReport.findUniqueOrThrow({
			where: { id: first.id },
			select: { priority: true, subjectId: true, details: true },
		}),
	).toEqual({
		priority: 'high',
		subjectId: author.id,
		details: 'Contains a private address.',
	})
	expect(
		await rejectionStatus(
			prisma.$transaction(tx =>
				createModerationReport(tx, {
					reporterId: author.id,
					targetType: 'review',
					targetId: review.id,
					reasonCategory: 'other',
					details: '',
				}),
			),
		),
	).toBe(400)
})

test('moderators can hide and restore member content with notices and immutable audit events', async () => {
	const [reporter, author, moderator] = await Promise.all([
		createUser('reporter'),
		createUser('author'),
		createUser('moderator', 'moderator'),
	])
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Audit trail test' },
	})
	const review = await prisma.review.create({
		data: {
			authorId: author.id,
			mediaId: media.id,
			body: 'Content requiring moderation.',
		},
	})
	const report = await prisma.$transaction(tx =>
		createModerationReport(tx, {
			reporterId: reporter.id,
			targetType: 'review',
			targetId: review.id,
			reasonCategory: 'harassment',
			details: 'Directed abuse.',
		}),
	)

	await prisma.$transaction(tx =>
		moderateContent(tx, {
			actorId: moderator.id,
			targetType: 'review',
			targetId: review.id,
			nextStatus: 'hidden',
			reason: 'Directed harassment.',
			reportId: report.id,
		}),
	)

	expect(
		await prisma.review.findUniqueOrThrow({
			where: { id: review.id },
			select: { moderationStatus: true, moderationReason: true },
		}),
	).toEqual({
		moderationStatus: 'hidden',
		moderationReason: 'Directed harassment.',
	})
	expect(
		await prisma.moderationReport.findUniqueOrThrow({
			where: { id: report.id },
			select: { status: true, assignedToId: true },
		}),
	).toEqual({ status: 'resolved', assignedToId: moderator.id })
	expect(
		await prisma.notification.findFirst({
			where: { recipientId: author.id, type: 'moderation_notice' },
			select: { message: true },
		}),
	).toEqual({
		message: expect.stringContaining('Directed harassment.'),
	})

	await prisma.$transaction(tx =>
		moderateContent(tx, {
			actorId: moderator.id,
			targetType: 'review',
			targetId: review.id,
			nextStatus: 'visible',
			reason: 'Appeal accepted.',
		}),
	)
	expect(
		await prisma.moderationAction.findMany({
			where: { targetId: review.id },
			orderBy: { createdAt: 'asc' },
			select: { action: true, previousStatus: true, nextStatus: true },
		}),
	).toEqual([
		{
			action: 'hide_content',
			previousStatus: 'visible',
			nextStatus: 'hidden',
		},
		{
			action: 'restore_content',
			previousStatus: 'hidden',
			nextStatus: 'visible',
		},
	])

	const unrelatedMedia = await prisma.media.create({
		data: { kind: 'anime', title: 'Unrelated moderation target' },
	})
	const unrelatedReview = await prisma.review.create({
		data: {
			authorId: author.id,
			mediaId: unrelatedMedia.id,
			body: 'A separate moderation target.',
		},
	})
	expect(
		await rejectionStatus(
			prisma.$transaction(tx =>
				moderateContent(tx, {
					actorId: moderator.id,
					targetType: 'review',
					targetId: unrelatedReview.id,
					nextStatus: 'hidden',
					reason: 'Mismatched report guard.',
					reportId: report.id,
				}),
			),
		),
	).toBe(400)
})

test('account enforcement revokes sessions and respects staff hierarchy', async () => {
	const [member, moderator, otherModerator] = await Promise.all([
		createUser('member'),
		createUser('moderator', 'moderator'),
		createUser('other_moderator', 'moderator'),
	])
	await prisma.session.create({
		data: {
			userId: member.id,
			expirationDate: getSessionExpirationDate(),
		},
	})

	await prisma.$transaction(tx =>
		moderateAccount(tx, {
			actorId: moderator.id,
			subjectId: member.id,
			intent: 'suspend',
			reason: 'Repeated targeted harassment.',
			suspensionDays: 7,
		}),
	)

	const suspended = await prisma.user.findUniqueOrThrow({
		where: { id: member.id },
		select: {
			accountStatus: true,
			accountStatusReason: true,
			suspensionEndsAt: true,
			_count: { select: { sessions: true } },
		},
	})
	expect(suspended.accountStatus).toBe('suspended')
	expect(suspended.accountStatusReason).toBe('Repeated targeted harassment.')
	expect(suspended.suspensionEndsAt).not.toBeNull()
	expect(suspended._count.sessions).toBe(0)
	expect(
		await prisma.notification.findFirst({
			where: {
				recipientId: member.id,
				type: 'moderation_notice',
				message: { contains: 'Repeated targeted harassment.' },
			},
		}),
	).not.toBeNull()

	expect(
		await rejectionStatus(
			prisma.$transaction(tx =>
				moderateAccount(tx, {
					actorId: moderator.id,
					subjectId: otherModerator.id,
					intent: 'warn',
					reason: 'Hierarchy test.',
				}),
			),
		),
	).toBe(403)

	const protectedReport = await prisma.moderationReport.create({
		data: {
			reporterId: member.id,
			subjectId: otherModerator.id,
			targetType: 'account',
			targetId: otherModerator.id,
			reasonCategory: 'other',
		},
	})
	expect(
		await rejectionStatus(
			prisma.$transaction(tx =>
				updateReportWorkflow(tx, {
					actorId: moderator.id,
					reportId: protectedReport.id,
					intent: 'dismiss',
					note: 'A peer must not close this report.',
				}),
			),
		),
	).toBe(403)
})

test('community administrators alone can grant and revoke moderator access', async () => {
	const [member, moderator, communityAdmin] = await Promise.all([
		createUser('member'),
		createUser('moderator', 'moderator'),
		createUser('community_admin', 'community-admin'),
	])

	expect(
		await rejectionStatus(
			prisma.$transaction(tx =>
				setModeratorRole(tx, {
					actorId: moderator.id,
					username: member.username,
					intent: 'grant-moderator',
					reason: 'Should be denied.',
				}),
			),
		),
	).toBe(403)

	await prisma.$transaction(tx =>
		setModeratorRole(tx, {
			actorId: communityAdmin.id,
			username: member.username,
			intent: 'grant-moderator',
			reason: 'Completed moderator onboarding.',
		}),
	)
	expect(
		await prisma.user.findUniqueOrThrow({
			where: { id: member.id },
			select: { roles: { select: { name: true } } },
		}),
	).toEqual({ roles: [{ name: 'moderator' }] })

	await prisma.$transaction(async tx => {
		await updateReportWorkflow(tx, {
			actorId: communityAdmin.id,
			reportId: (
				await tx.moderationReport.create({
					data: {
						reporterId: moderator.id,
						subjectId: member.id,
						targetType: 'account',
						targetId: member.id,
						reasonCategory: 'other',
					},
				})
			).id,
			intent: 'dismiss',
			note: 'No policy violation.',
		})
	})
	expect(
		await prisma.moderationAction.count({
			where: { actorId: communityAdmin.id },
		}),
	).toBe(2)

	await prisma.$transaction(tx =>
		setModeratorRole(tx, {
			actorId: communityAdmin.id,
			username: member.username,
			intent: 'revoke-moderator',
			reason: 'Rotation completed.',
		}),
	)
	expect(
		await prisma.user.findUniqueOrThrow({
			where: { id: member.id },
			select: { roles: { select: { name: true } } },
		}),
	).toEqual({ roles: [] })
})

test('appeals are bound to an exact decision and restoration notifies the member', async () => {
	const [author, moderator] = await Promise.all([
		createUser('appeal_author'),
		createUser('appeal_moderator', 'moderator'),
	])
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Appeal fixture' },
	})
	const review = await prisma.review.create({
		data: {
			authorId: author.id,
			mediaId: media.id,
			body: 'A decision that will be appealed.',
		},
	})
	await prisma.$transaction(tx =>
		moderateContent(tx, {
			actorId: moderator.id,
			targetType: 'review',
			targetId: review.id,
			nextStatus: 'hidden',
			reason: 'Initial moderation decision.',
		}),
	)
	const action = await prisma.moderationAction.findFirstOrThrow({
		where: { targetId: review.id, action: 'hide_content' },
	})

	const appeal = await prisma.$transaction(tx =>
		createModerationAppeal(tx, {
			reporterId: author.id,
			actionId: action.id,
			details: 'The quoted context changes the meaning of this review.',
		}),
	)
	const duplicate = await prisma.$transaction(tx =>
		createModerationAppeal(tx, {
			reporterId: author.id,
			actionId: action.id,
			details: 'A duplicate appeal.',
		}),
	)
	expect(duplicate).toEqual({ id: appeal.id, duplicate: true })
	expect(
		await prisma.moderationReport.findUniqueOrThrow({
			where: { id: appeal.id },
			select: { reasonCategory: true, appealOfActionId: true, status: true },
		}),
	).toEqual({
		reasonCategory: 'appeal',
		appealOfActionId: action.id,
		status: 'open',
	})

	await prisma.$transaction(tx =>
		moderateContent(tx, {
			actorId: moderator.id,
			targetType: 'review',
			targetId: review.id,
			nextStatus: 'visible',
			reason: 'Appeal accepted after context review.',
			reportId: appeal.id,
		}),
	)
	expect(
		await prisma.notification.findFirst({
			where: {
				recipientId: author.id,
				type: 'moderation_notice',
				message: { contains: 'appeal was accepted' },
			},
		}),
	).not.toBeNull()
})
