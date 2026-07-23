import { invariant } from '@epic-web/invariant'
import { prisma } from '#app/utils/db.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type VerifyFunctionArgs } from './verify.server.ts'

export const moderationAppealVerificationType = 'moderation-appeal'

export async function handleModerationAppealVerification({
	submission,
}: VerifyFunctionArgs) {
	invariant(
		submission.status === 'success',
		'Submission should be successful by now',
	)
	const draftId = submission.value.target
	const draft = await prisma.moderationAppealDraft.findFirst({
		where: { id: draftId, expiresAt: { gt: new Date() } },
		select: {
			id: true,
			details: true,
			userId: true,
			actionId: true,
			action: {
				select: {
					action: true,
					subjectId: true,
					targetType: true,
					targetId: true,
					appeal: { select: { id: true, status: true } },
				},
			},
		},
	})
	const existing = draft?.action.appeal
	if (
		draft &&
		draft.action.action === 'account_suspend' &&
		draft.action.subjectId === draft.userId &&
		!existing
	) {
		await prisma
			.$transaction([
				prisma.moderationReport.create({
					data: {
						reporterId: draft.userId,
						subjectId: draft.userId,
						targetType: draft.action.targetType,
						targetId: draft.action.targetId,
						reasonCategory: 'appeal',
						details: draft.details,
						appealOfActionId: draft.actionId,
					},
				}),
				prisma.moderationAppealDraft.deleteMany({
					where: {
						userId: draft.userId,
						actionId: draft.actionId,
					},
				}),
			])
			.catch(async error => {
				if (
					error &&
					typeof error === 'object' &&
					'code' in error &&
					error.code === 'P2002'
				) {
					await prisma.moderationAppealDraft.deleteMany({
						where: {
							userId: draft.userId,
							actionId: draft.actionId,
						},
					})
					return
				}
				throw error
			})
	} else if (draft) {
		await prisma.moderationAppealDraft.delete({ where: { id: draft.id } })
	}
	return redirectWithToast('/login', {
		type: 'success',
		title: 'Appeal received',
		description:
			existing?.status === 'resolved' || existing?.status === 'dismissed'
				? 'This decision was already reviewed. Check your moderation notice for the outcome.'
				: 'Your verified appeal is in the private moderation queue.',
	})
}
