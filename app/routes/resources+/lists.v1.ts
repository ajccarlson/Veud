import { data as json, type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { executeListCommand } from '#app/utils/lists/list-commands.server.ts'
import { ListMutationRequestSchema } from '#app/utils/lists/mutation-contracts.ts'

function errorCode(status: number) {
	if (status === 400 || status === 422) return 'VALIDATION_FAILED' as const
	if (status === 401 || (status >= 300 && status < 400)) {
		return 'UNAUTHENTICATED' as const
	}
	if (status === 403) return 'FORBIDDEN' as const
	if (status === 404) return 'NOT_FOUND' as const
	if (status === 409) return 'CONFLICT' as const
	return 'INTERNAL_ERROR' as const
}

export async function action({ request }: ActionFunctionArgs) {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'List mutations require application/json',
				},
			},
			{ status: 415 },
		)
	}

	const declaredLength = Number(request.headers.get('content-length') ?? 0)
	if (declaredLength > 1_000_000) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'List mutation payload is too large',
				},
			},
			{ status: 413 },
		)
	}
	const rawBody = await request.text()
	if (rawBody.length > 1_000_000) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'List mutation payload is too large',
				},
			},
			{ status: 413 },
		)
	}
	const rawPayload = (() => {
		try {
			return JSON.parse(rawBody) as unknown
		} catch {
			return null
		}
	})()
	const parsed = ListMutationRequestSchema.safeParse(rawPayload)
	if (!parsed.success) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'Invalid list mutation request',
					issues: parsed.error.issues.map(issue => ({
						path: issue.path.join('.'),
						message: issue.message,
					})),
				},
			},
			{ status: 400 },
		)
	}

	try {
		const ownerId = await requireUserId(request)
		const result = await executeListCommand(ownerId, parsed.data)
		return json({ ok: true as const, data: result })
	} catch (error) {
		if (error instanceof Response) {
			const sourceStatus = error.status || 500
			const status =
				sourceStatus >= 300 && sourceStatus < 400 ? 401 : sourceStatus
			const message =
				(await error.text().catch(() => '')) || 'List request failed'
			return json(
				{
					ok: false as const,
					error: { code: errorCode(status), message },
				},
				{ status },
			)
		}
		console.error('[lists:v1] unexpected mutation error', error)
		return json(
			{
				ok: false as const,
				error: {
					code: 'INTERNAL_ERROR' as const,
					message: 'List request failed',
				},
			},
			{ status: 500 },
		)
	}
}
