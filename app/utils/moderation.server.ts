import { type Prisma } from '@prisma/client'
import {
	isModerationTargetType,
	type ModerationReason,
	type ModerationTargetType,
	moderationReasonLabels,
} from './moderation.ts'

type Transaction = Prisma.TransactionClient

const OPEN_REPORT_STATUSES = ['open', 'in_review']
const STAFF_ROLE_RANK: Record<string, number> = {
	user: 0,
	moderator: 1,
	'community-admin': 2,
	admin: 3,
}

type ModerationTarget = {
	id: string
	type: ModerationTargetType
	subjectId: string
	label: string
	excerpt: string
	status: string
	context: { mediaId?: string; collectionId?: string; username?: string }
}

function excerpt(value: string | null | undefined) {
	const normalized = value?.replace(/\s+/g, ' ').trim() || 'No text'
	return normalized.length > 220
		? `${normalized.slice(0, 217).trimEnd()}…`
		: normalized
}

export async function findModerationTarget(
	tx: Transaction,
	targetType: ModerationTargetType,
	targetId: string,
): Promise<ModerationTarget | null> {
	if (targetType === 'account') {
		const user = await tx.user.findUnique({
			where: { id: targetId },
			select: {
				id: true,
				username: true,
				name: true,
				bio: true,
				accountStatus: true,
			},
		})
		return user
			? {
					id: user.id,
					type: targetType,
					subjectId: user.id,
					label: user.name ?? user.username,
					excerpt: excerpt(user.bio ?? `@${user.username}`),
					status: user.accountStatus,
					context: { username: user.username },
				}
			: null
	}
	if (targetType === 'review') {
		const review = await tx.review.findUnique({
			where: { id: targetId },
			select: {
				id: true,
				body: true,
				authorId: true,
				moderationStatus: true,
				media: { select: { id: true, title: true } },
			},
		})
		return review
			? {
					id: review.id,
					type: targetType,
					subjectId: review.authorId,
					label: `Review of ${review.media.title || 'untitled media'}`,
					excerpt: excerpt(review.body),
					status: review.moderationStatus,
					context: { mediaId: review.media.id },
				}
			: null
	}
	if (targetType === 'review_comment') {
		const comment = await tx.reviewComment.findUnique({
			where: { id: targetId },
			select: {
				id: true,
				body: true,
				authorId: true,
				moderationStatus: true,
				review: { select: { mediaId: true } },
			},
		})
		return comment
			? {
					id: comment.id,
					type: targetType,
					subjectId: comment.authorId,
					label: 'Review comment',
					excerpt: excerpt(comment.body),
					status: comment.moderationStatus,
					context: { mediaId: comment.review.mediaId },
				}
			: null
	}
	if (targetType === 'collection') {
		const collection = await tx.mediaCollection.findUnique({
			where: { id: targetId },
			select: {
				id: true,
				title: true,
				description: true,
				ownerId: true,
				moderationStatus: true,
			},
		})
		return collection
			? {
					id: collection.id,
					type: targetType,
					subjectId: collection.ownerId,
					label: collection.title,
					excerpt: excerpt(collection.description),
					status: collection.moderationStatus,
					context: { collectionId: collection.id },
				}
			: null
	}
	if (targetType === 'collection_comment') {
		const comment = await tx.collectionComment.findUnique({
			where: { id: targetId },
			select: {
				id: true,
				body: true,
				authorId: true,
				collectionId: true,
				moderationStatus: true,
			},
		})
		return comment
			? {
					id: comment.id,
					type: targetType,
					subjectId: comment.authorId,
					label: 'Collection comment',
					excerpt: excerpt(comment.body),
					status: comment.moderationStatus,
					context: { collectionId: comment.collectionId },
				}
			: null
	}
	const comment = await tx.profileComment.findUnique({
		where: { id: targetId },
		select: {
			id: true,
			body: true,
			authorId: true,
			moderationStatus: true,
			profile: { select: { username: true } },
		},
	})
	return comment
		? {
				id: comment.id,
				type: targetType,
				subjectId: comment.authorId,
				label: `Profile comment on @${comment.profile.username}`,
				excerpt: excerpt(comment.body),
				status: comment.moderationStatus,
				context: { username: comment.profile.username },
			}
		: null
}

async function userRank(tx: Transaction, userId: string) {
	const user = await tx.user.findUnique({
		where: { id: userId },
		select: { roles: { select: { name: true } } },
	})
	return Math.max(
		-1,
		...(user?.roles.map(role => STAFF_ROLE_RANK[role.name] ?? 0) ?? []),
	)
}

async function assertCanActOnSubject(
	tx: Transaction,
	actorId: string,
	subjectId: string,
) {
	if (actorId === subjectId) {
		throw new Response(
			'Moderators cannot act on their own account or content',
			{
				status: 403,
			},
		)
	}
	const [actorRank, subjectRank] = await Promise.all([
		userRank(tx, actorId),
		userRank(tx, subjectId),
	])
	if (actorRank <= subjectRank) {
		throw new Response('A higher-ranked staff member must review this target', {
			status: 403,
		})
	}
}

export async function createModerationReport(
	tx: Transaction,
	input: {
		reporterId: string
		targetType: ModerationTargetType
		targetId: string
		reasonCategory: ModerationReason
		details: string
	},
) {
	const target = await findModerationTarget(
		tx,
		input.targetType,
		input.targetId,
	)
	if (!target) throw new Response('Report target not found', { status: 404 })
	if (target.subjectId === input.reporterId) {
		throw new Response('You cannot report your own content', { status: 400 })
	}
	const existing = await tx.moderationReport.findFirst({
		where: {
			reporterId: input.reporterId,
			targetType: input.targetType,
			targetId: input.targetId,
			status: { in: OPEN_REPORT_STATUSES },
		},
		select: { id: true },
	})
	if (existing) return { id: existing.id, duplicate: true }
	const recentReportCount = await tx.moderationReport.count({
		where: {
			reporterId: input.reporterId,
			createdAt: { gte: new Date(Date.now() - 60 * 60 * 1_000) },
		},
	})
	if (recentReportCount >= 20) {
		throw new Response('Report limit reached. Try again later.', {
			status: 429,
			headers: { 'Retry-After': '3600' },
		})
	}

	const report = await tx.moderationReport.create({
		data: {
			reporterId: input.reporterId,
			subjectId: target.subjectId,
			targetType: input.targetType,
			targetId: input.targetId,
			reasonCategory: input.reasonCategory,
			details: input.details,
			priority:
				input.reasonCategory === 'violence_or_threat' ||
				input.reasonCategory === 'privacy'
					? 'high'
					: 'normal',
		},
		select: { id: true },
	})
	return { id: report.id, duplicate: false }
}

const APPEALABLE_ACTIONS = new Set([
	'hide_content',
	'account_warn',
	'account_suspend',
])

export async function createModerationAppeal(
	tx: Transaction,
	input: {
		reporterId: string
		actionId: string
		details: string
	},
) {
	const action = await tx.moderationAction.findFirst({
		where: { id: input.actionId, subjectId: input.reporterId },
		select: {
			id: true,
			action: true,
			targetType: true,
			targetId: true,
			subjectId: true,
			appeal: { select: { id: true } },
		},
	})
	if (!action || !APPEALABLE_ACTIONS.has(action.action)) {
		throw new Response('Moderation decision not found', { status: 404 })
	}
	if (action.appeal) {
		return { id: action.appeal.id, duplicate: true }
	}
	if (!isModerationTargetType(action.targetType)) {
		throw new Response('This moderation decision cannot be appealed', {
			status: 400,
		})
	}
	const target = await findModerationTarget(
		tx,
		action.targetType,
		action.targetId,
	)
	if (!target || target.subjectId !== input.reporterId) {
		throw new Response('Moderation decision not found', { status: 404 })
	}
	if (action.action === 'hide_content' && target.status !== 'hidden') {
		throw new Response('This content has already been restored', {
			status: 409,
		})
	}

	const report = await tx.moderationReport.create({
		data: {
			reporterId: input.reporterId,
			subjectId: input.reporterId,
			targetType: action.targetType,
			targetId: action.targetId,
			reasonCategory: 'appeal',
			details: input.details,
			appealOfActionId: action.id,
		},
		select: { id: true },
	})
	return { id: report.id, duplicate: false }
}

async function updateContentState(
	tx: Transaction,
	target: ModerationTarget,
	nextStatus: 'visible' | 'hidden',
	reason: string,
) {
	const data = {
		moderationStatus: nextStatus,
		moderationReason: nextStatus === 'hidden' ? reason : null,
		moderatedAt: new Date(),
	}
	if (target.type === 'review') {
		await tx.review.update({ where: { id: target.id }, data })
	} else if (target.type === 'review_comment') {
		await tx.reviewComment.update({ where: { id: target.id }, data })
	} else if (target.type === 'collection') {
		await tx.mediaCollection.update({ where: { id: target.id }, data })
	} else if (target.type === 'collection_comment') {
		await tx.collectionComment.update({ where: { id: target.id }, data })
	} else if (target.type === 'profile_comment') {
		await tx.profileComment.update({ where: { id: target.id }, data })
	} else {
		throw new Response('Account state requires an account action', {
			status: 400,
		})
	}
}

export async function moderateContent(
	tx: Transaction,
	input: {
		actorId: string
		targetType: Exclude<ModerationTargetType, 'account'>
		targetId: string
		nextStatus: 'visible' | 'hidden'
		reason: string
		reportId?: string
	},
) {
	const target = await findModerationTarget(
		tx,
		input.targetType,
		input.targetId,
	)
	if (!target) throw new Response('Content not found', { status: 404 })
	await assertCanActOnSubject(tx, input.actorId, target.subjectId)
	if (target.status === input.nextStatus) return target

	const linkedReport = input.reportId
		? await tx.moderationReport.findFirst({
				where: {
					id: input.reportId,
					targetType: input.targetType,
					targetId: input.targetId,
				},
				select: { reasonCategory: true, reporterId: true },
			})
		: null
	if (input.reportId && !linkedReport) {
		throw new Response('Report does not match this content', { status: 400 })
	}
	await updateContentState(tx, target, input.nextStatus, input.reason)
	const now = new Date()
	if (input.reportId) {
		await tx.moderationReport.updateMany({
			where: {
				id: input.reportId,
				targetType: input.targetType,
				targetId: input.targetId,
			},
			data: {
				status: 'resolved',
				resolutionNote: input.reason,
				resolvedAt: now,
				assignedToId: input.actorId,
			},
		})
	}
	await tx.moderationAction.create({
		data: {
			actorId: input.actorId,
			subjectId: target.subjectId,
			reportId: input.reportId,
			action:
				input.nextStatus === 'hidden' ? 'hide_content' : 'restore_content',
			targetType: input.targetType,
			targetId: input.targetId,
			reason: input.reason,
			previousStatus: target.status,
			nextStatus: input.nextStatus,
		},
	})
	if (input.nextStatus === 'hidden') {
		await tx.notification.create({
			data: {
				type: 'moderation_notice',
				recipientId: target.subjectId,
				actorId: input.actorId,
				message: `A moderator hid your ${target.label.toLowerCase()}. Reason: ${input.reason}`,
			},
		})
	} else if (linkedReport?.reasonCategory === 'appeal') {
		await tx.notification.create({
			data: {
				type: 'moderation_notice',
				recipientId: linkedReport.reporterId,
				actorId: input.actorId,
				message: `Your appeal was accepted and the content was restored. Decision: ${input.reason}`,
			},
		})
	}
	return { ...target, status: input.nextStatus }
}

export async function updateReportWorkflow(
	tx: Transaction,
	input: {
		actorId: string
		reportId: string
		intent: 'assign-self' | 'resolve' | 'dismiss' | 'reopen'
		note: string
	},
) {
	const report = await tx.moderationReport.findUnique({
		where: { id: input.reportId },
		select: {
			id: true,
			targetType: true,
			targetId: true,
			subjectId: true,
			reporterId: true,
			reasonCategory: true,
			status: true,
		},
	})
	if (!report) throw new Response('Report not found', { status: 404 })
	if (report.subjectId) {
		await assertCanActOnSubject(tx, input.actorId, report.subjectId)
	}
	const nextStatus =
		input.intent === 'assign-self'
			? 'in_review'
			: input.intent === 'reopen'
				? 'open'
				: input.intent === 'resolve'
					? 'resolved'
					: 'dismissed'
	const terminal = nextStatus === 'resolved' || nextStatus === 'dismissed'
	await tx.moderationReport.update({
		where: { id: report.id },
		data: {
			status: nextStatus,
			assignedToId: input.intent === 'reopen' ? null : input.actorId,
			resolutionNote: terminal ? input.note : null,
			resolvedAt: terminal ? new Date() : null,
		},
	})
	await tx.moderationAction.create({
		data: {
			actorId: input.actorId,
			subjectId: report.subjectId,
			reportId: report.id,
			action: `report_${input.intent.replace('-', '_')}`,
			targetType: report.targetType,
			targetId: report.targetId,
			reason: input.note || input.intent,
			previousStatus: report.status,
			nextStatus,
		},
	})
	if (terminal && report.reasonCategory === 'appeal') {
		await tx.notification.create({
			data: {
				type: 'moderation_notice',
				recipientId: report.reporterId,
				actorId: input.actorId,
				message: `Your moderation appeal was ${nextStatus}. Decision: ${input.note}`,
			},
		})
	}
	return { id: report.id, status: nextStatus }
}

export async function moderateAccount(
	tx: Transaction,
	input: {
		actorId: string
		subjectId: string
		intent: 'warn' | 'suspend' | 'restore'
		reason: string
		suspensionDays?: number
		reportId?: string
	},
) {
	await assertCanActOnSubject(tx, input.actorId, input.subjectId)
	const subject = await tx.user.findUnique({
		where: { id: input.subjectId },
		select: { id: true, accountStatus: true },
	})
	if (!subject) throw new Response('Member not found', { status: 404 })
	const linkedReport = input.reportId
		? await tx.moderationReport.findFirst({
				where: { id: input.reportId, subjectId: input.subjectId },
				select: { reasonCategory: true, reporterId: true },
			})
		: null
	if (input.reportId && !linkedReport) {
		throw new Response('Report does not match this member', { status: 400 })
	}

	if (input.intent === 'warn') {
		await tx.notification.create({
			data: {
				type: 'moderation_notice',
				recipientId: subject.id,
				actorId: input.actorId,
				message: `Moderator warning: ${input.reason}`,
			},
		})
	} else {
		const suspended = input.intent === 'suspend'
		await tx.user.update({
			where: { id: subject.id },
			data: {
				accountStatus: suspended ? 'suspended' : 'active',
				suspensionEndsAt:
					suspended && input.suspensionDays
						? new Date(Date.now() + input.suspensionDays * 86_400_000)
						: null,
				accountStatusReason: suspended ? input.reason : null,
			},
		})
		if (suspended) {
			await tx.session.deleteMany({ where: { userId: subject.id } })
		}
	}
	if (input.intent === 'suspend') {
		await tx.notification.create({
			data: {
				type: 'moderation_notice',
				recipientId: subject.id,
				actorId: input.actorId,
				message: `Your account was suspended. Reason: ${input.reason}`,
			},
		})
	}
	await tx.moderationAction.create({
		data: {
			actorId: input.actorId,
			subjectId: subject.id,
			reportId: input.reportId,
			action: `account_${input.intent}`,
			targetType: 'account',
			targetId: subject.id,
			reason: input.reason,
			previousStatus: subject.accountStatus,
			nextStatus:
				input.intent === 'warn'
					? subject.accountStatus
					: input.intent === 'suspend'
						? 'suspended'
						: 'active',
		},
	})
	if (input.reportId) {
		await tx.moderationReport.updateMany({
			where: { id: input.reportId, subjectId: subject.id },
			data: {
				status: 'resolved',
				resolutionNote: input.reason,
				resolvedAt: new Date(),
				assignedToId: input.actorId,
			},
		})
	}
	if (input.intent === 'restore' && linkedReport?.reasonCategory === 'appeal') {
		await tx.notification.create({
			data: {
				type: 'moderation_notice',
				recipientId: linkedReport.reporterId,
				actorId: input.actorId,
				message: `Your appeal was accepted and your account was restored. Decision: ${input.reason}`,
			},
		})
	}
	return { id: subject.id, intent: input.intent }
}

export async function setModeratorRole(
	tx: Transaction,
	input: {
		actorId: string
		username: string
		intent: 'grant-moderator' | 'revoke-moderator'
		reason: string
	},
) {
	const actorRank = await userRank(tx, input.actorId)
	if (actorRank < STAFF_ROLE_RANK['community-admin']) {
		throw new Response('Community administrator access is required', {
			status: 403,
		})
	}
	const target = await tx.user.findUnique({
		where: { username: input.username },
		select: {
			id: true,
			username: true,
			roles: { select: { name: true } },
		},
	})
	if (!target) throw new Response('Member not found', { status: 404 })
	if (target.id === input.actorId) {
		throw new Response('You cannot change your own moderator role', {
			status: 403,
		})
	}
	const targetRank = Math.max(
		0,
		...target.roles.map(role => STAFF_ROLE_RANK[role.name] ?? 0),
	)
	if (targetRank >= actorRank) {
		throw new Response(
			'A higher-ranked administrator must manage this member',
			{
				status: 403,
			},
		)
	}
	const granting = input.intent === 'grant-moderator'
	await tx.user.update({
		where: { id: target.id },
		data: {
			roles: granting
				? { connect: { name: 'moderator' } }
				: { disconnect: { name: 'moderator' } },
		},
	})
	await tx.moderationAction.create({
		data: {
			actorId: input.actorId,
			subjectId: target.id,
			action: input.intent.replace('-', '_'),
			targetType: 'role',
			targetId: 'moderator',
			reason: input.reason,
			previousStatus: granting ? 'not_assigned' : 'assigned',
			nextStatus: granting ? 'assigned' : 'not_assigned',
			details: `Moderator role ${granting ? 'granted to' : 'revoked from'} @${target.username}`,
		},
	})
	return { username: target.username, assigned: granting }
}

export function defaultModerationReason(reason: ModerationReason) {
	return moderationReasonLabels[reason]
}
