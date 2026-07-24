import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	assistReviewDraft,
	reviewAssistanceOperations,
} from '#app/utils/review-assistance.server.ts'

const RequestSchema = z.object({
	draft: z.string().trim().min(20).max(10_000),
	operation: z.enum(reviewAssistanceOperations),
})

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const contentLength = Number(request.headers.get('content-length') ?? '0')
	if (contentLength > 12_000) {
		return json(
			{ ok: false as const, error: 'Review request is too large.' },
			{ status: 413 },
		)
	}
	const parsed = RequestSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return json(
			{
				ok: false as const,
				error: 'Write at least 20 characters before requesting assistance.',
			},
			{ status: 400 },
		)
	}
	try {
		return json({
			ok: true as const,
			assistance: await assistReviewDraft({
				...parsed.data,
				rateLimitKey: `viewer:${ownerId}`,
			}),
		})
	} catch (error) {
		return json(
			{
				ok: false as const,
				error:
					error instanceof Response
						? await error.text()
						: 'Review assistance is temporarily unavailable.',
			},
			{ status: error instanceof Response ? error.status : 503 },
		)
	}
}
