import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { setUserSafetyControl } from '#app/utils/user-safety.server.ts'

const UserSafetySchema = z.object({
	targetId: z.string().trim().min(1).max(100),
	kind: z.enum(['mute', 'block']),
	enabled: z.boolean(),
})

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new Response('Safety controls require application/json', {
			status: 415,
		})
	}
	const parsed = UserSafetySchema.safeParse(
		await request.json().catch(() => null),
	)
	if (!parsed.success) {
		throw new Response('Invalid safety control', { status: 400 })
	}
	const state = await prisma.$transaction(tx =>
		setUserSafetyControl(tx, { ownerId, ...parsed.data }),
	)
	return json({ ok: true as const, data: state })
}
