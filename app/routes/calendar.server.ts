import { data as json } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	releaseReminderLeadMinutes,
	removeReleaseReminder,
	saveReleaseReminder,
	type ReleaseReminderLeadMinutes,
} from '#app/utils/release-reminders.server.ts'

const ReminderLeadSchema = z.coerce
	.number()
	.int()
	.refine(value =>
		releaseReminderLeadMinutes.includes(value as ReleaseReminderLeadMinutes),
	)
	.transform(value => value as ReleaseReminderLeadMinutes)

const ReminderActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('release-reminder-save'),
		mediaId: z.string().min(1).max(100),
		leadMinutes: ReminderLeadSchema,
	}),
	z.object({
		intent: z.literal('release-reminder-delete'),
		mediaId: z.string().min(1).max(100),
	}),
])

// Both the weekly calendar and the per-day pages post reminder toggles to
// their own URL, so they share this action.
export async function releaseReminderAction(request: Request) {
	const viewerId = await requireUserId(request)
	const parsed = ReminderActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		throw new Response('Invalid reminder action', { status: 400 })
	}
	const media = await prisma.media.findUnique({
		where: { id: parsed.data.mediaId },
		select: { id: true },
	})
	if (!media) throw new Response('Media not found', { status: 404 })

	if (parsed.data.intent === 'release-reminder-save') {
		const leadMinutes = parsed.data.leadMinutes
		const reminder = await prisma.$transaction(transaction =>
			saveReleaseReminder(transaction, {
				ownerId: viewerId,
				mediaId: media.id,
				leadMinutes,
			}),
		)
		return json({ ok: true, reminderId: reminder.id })
	}

	await removeReleaseReminder(prisma, {
		ownerId: viewerId,
		mediaId: media.id,
	})
	return json({ ok: true })
}
