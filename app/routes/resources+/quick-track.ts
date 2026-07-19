import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { setMediaTrackingStatus } from '#app/utils/tracking-status.server.ts'

const QuickTrackSchema = z.object({
	mediaId: z.string().min(1).max(100),
	watchlistId: z.string().min(1).max(100),
})

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const parsed = QuickTrackSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		throw new Response('Invalid tracking update', { status: 400 })
	}

	const tracking = await prisma.$transaction(tx =>
		setMediaTrackingStatus(tx, { ownerId, ...parsed.data }),
	)
	return json({ ok: true as const, tracking })
}
