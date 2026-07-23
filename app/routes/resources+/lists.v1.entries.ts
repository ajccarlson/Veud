import { data as json, type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import {
	ListEntriesQuerySchema,
	type ListMutationError,
} from '#app/utils/lists/mutation-contracts.ts'
import { requireVisibleWatchlist } from '#app/utils/lists/visibility.server.ts'

const noStore = { 'Cache-Control': 'private, no-store' }

export async function loader({ request }: LoaderFunctionArgs) {
	const parsed = ListEntriesQuerySchema.safeParse(
		Object.fromEntries(new URL(request.url).searchParams),
	)
	if (!parsed.success) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST',
					message: 'Invalid list entries request',
					issues: parsed.error.issues.map(issue => ({
						path: issue.path.join('.'),
						message: issue.message,
					})),
				} satisfies ListMutationError,
			},
			{ status: 400, headers: noStore },
		)
	}

	try {
		const { watchlist } = await requireVisibleWatchlist(
			request,
			parsed.data.watchlistId,
		)
		const entries = await prisma.entry.findMany({
			where: { watchlistId: watchlist.id },
			orderBy: { position: 'asc' },
		})
		return json({ ok: true as const, data: entries }, { headers: noStore })
	} catch (error) {
		if (error instanceof Response) {
			const sourceStatus = error.status || 500
			const status =
				sourceStatus >= 300 && sourceStatus < 400 ? 401 : sourceStatus
			return json(
				{
					ok: false as const,
					error: {
						code:
							status === 404
								? ('NOT_FOUND' as const)
								: status === 403
									? ('FORBIDDEN' as const)
									: status === 401
										? ('UNAUTHENTICATED' as const)
										: ('INTERNAL_ERROR' as const),
						message:
							(await error.text().catch(() => '')) ||
							'List entries are unavailable',
					},
				},
				{ status, headers: noStore },
			)
		}
		console.error('[lists:v1] unexpected entries error', error)
		return json(
			{
				ok: false as const,
				error: {
					code: 'INTERNAL_ERROR' as const,
					message: 'List entries are unavailable',
				},
			},
			{ status: 500, headers: noStore },
		)
	}
}
