import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

const RecommendationFeedbackSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('hide'),
		mediaId: z.string().min(1).max(100),
		feedbackType: z.enum(['not_interested', 'show_less']),
		sourceLane: z
			.enum(['connected', 'circle', 'collections', 'taste'])
			.optional(),
	}),
	z.object({
		intent: z.literal('restore'),
		mediaId: z.string().min(1).max(100),
	}),
])
const noStore = { headers: { 'Cache-Control': 'private, no-store' } }

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const parsed = RecommendationFeedbackSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return json(
			{ ok: false as const, error: 'Invalid recommendation feedback' },
			{ status: 400, ...noStore },
		)
	}

	if (parsed.data.intent === 'restore') {
		await prisma.recommendationFeedback.deleteMany({
			where: { ownerId, mediaId: parsed.data.mediaId },
		})
		return json(
			{
				ok: true as const,
				intent: parsed.data.intent,
				mediaId: parsed.data.mediaId,
			},
			noStore,
		)
	}

	const media = await prisma.media.findUnique({
		where: { id: parsed.data.mediaId },
		select: { id: true },
	})
	if (!media) {
		return json(
			{ ok: false as const, error: 'Recommendation title not found' },
			{ status: 404, ...noStore },
		)
	}
	await prisma.recommendationFeedback.upsert({
		where: {
			ownerId_mediaId: { ownerId, mediaId: parsed.data.mediaId },
		},
		create: {
			ownerId,
			mediaId: parsed.data.mediaId,
			feedbackType: parsed.data.feedbackType,
			sourceLane: parsed.data.sourceLane,
		},
		update: {
			feedbackType: parsed.data.feedbackType,
			sourceLane: parsed.data.sourceLane,
		},
	})
	return json(
		{
			ok: true as const,
			intent: parsed.data.intent,
			mediaId: parsed.data.mediaId,
			feedbackType: parsed.data.feedbackType,
		},
		noStore,
	)
}
