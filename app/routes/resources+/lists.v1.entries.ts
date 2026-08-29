import { type Prisma } from '@prisma/client'
import { data as json, type LoaderFunctionArgs } from 'react-router'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	ListEntriesQuerySchema,
	type ListMutationError,
} from '#app/utils/lists/mutation-contracts.ts'
import {
	canonicalizeLinkedWatchlistEntry,
	prepareWatchlistEntryForViewer,
	publicEntryPayload,
} from '#app/utils/lists/public-watchlist.server.ts'
import { visibleWatchlistWhere } from '#app/utils/lists/visibility.server.ts'
import { normalizeWatchlistEntryScores } from '#app/utils/lists/watchlist-entry-scores.server.ts'
import { getViewerTitleLanguage } from '#app/utils/media-title.server.ts'

const noStore = { 'Cache-Control': 'private, no-store' }

const listEntryMediaSelect = {
	kind: true,
	thumbnail: true,
	title: true,
	englishTitle: true,
	type: true,
	releaseStart: true,
	releaseEnd: true,
	nextRelease: true,
	genres: true,
	description: true,
	airYear: true,
	startSeason: true,
	startYear: true,
	rating: true,
	language: true,
	studios: true,
	serialization: true,
	authors: true,
	tmdbScore: true,
	malScore: true,
	externalIds: {
		orderBy: [
			{ provider: 'asc' as const },
			{ kind: 'asc' as const },
			{ externalId: 'asc' as const },
		],
		select: {
			provider: true,
			kind: true,
			externalId: true,
		},
	},
} satisfies Prisma.MediaSelect

export async function loader({ request }: LoaderFunctionArgs) {
	const viewerId = await getUserId(request)
	const titleLanguage = await getViewerTitleLanguage(request, viewerId)
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
		const isolationLevel = process.env.DATABASE_URL?.startsWith('postgres')
			? ('RepeatableRead' as Prisma.TransactionIsolationLevel)
			: ('Serializable' as Prisma.TransactionIsolationLevel)
		const { rows, watchlist } = await prisma.$transaction(
			async tx => {
				const visibleWatchlist = await tx.watchlist.findFirst({
					where: {
						id: parsed.data.watchlistId,
						AND: [visibleWatchlistWhere(viewerId)],
					},
				})
				if (!visibleWatchlist) {
					throw new Response('Not found', { status: 404 })
				}
				if (
					parsed.data.revision !== undefined &&
					parsed.data.revision !== visibleWatchlist.mutationVersion
				) {
					throw new Response(
						'This list changed while its entries were loading. Refresh and try again.',
						{ status: 409 },
					)
				}

				const cursorEntry = parsed.data.cursor
					? await tx.entry.findUnique({
							where: { id: parsed.data.cursor },
							select: { id: true, watchlistId: true, position: true },
						})
					: null
				if (
					parsed.data.cursor &&
					(!cursorEntry || cursorEntry.watchlistId !== visibleWatchlist.id)
				) {
					throw new Response('Invalid list entries cursor', { status: 400 })
				}

				const pageRows = await tx.entry.findMany({
					where: {
						watchlistId: visibleWatchlist.id,
						...(cursorEntry
							? {
									OR: [
										{ position: { gt: cursorEntry.position } },
										{
											position: cursorEntry.position,
											id: { gt: cursorEntry.id },
										},
									],
								}
							: {}),
					},
					orderBy: [{ position: 'asc' }, { id: 'asc' }],
					take: parsed.data.take + 1,
					include: {
						media: { select: listEntryMediaSelect },
						trackingState: {
							select: {
								ownerId: true,
								mediaId: true,
								statusWatchlistId: true,
								score: true,
								startedAt: true,
								completedAt: true,
								statusWatchlist: {
									select: { ownerId: true, isPublic: true },
								},
							},
						},
					},
				})
				return { rows: pageRows, watchlist: visibleWatchlist }
			},
			{ isolationLevel },
		)
		const hasMore = rows.length > parsed.data.take
		const entries = hasMore ? rows.slice(0, parsed.data.take) : rows
		const isOwner = viewerId === watchlist.ownerId
		const normalized = entries
			.map(entry =>
				prepareWatchlistEntryForViewer(entry, watchlist.ownerId, isOwner),
			)
			.map(entry => canonicalizeLinkedWatchlistEntry(entry, titleLanguage))
			.map(normalizeWatchlistEntryScores)
		const browserEntries = isOwner
			? normalized
			: normalized.map(entry =>
					publicEntryPayload(entry, watchlist.displayedColumns),
				)
		return json(
			{
				ok: true as const,
				data: browserEntries,
				pagination: {
					nextCursor: hasMore ? (entries.at(-1)?.id ?? null) : null,
					revision: watchlist.mutationVersion,
				},
			},
			{ headers: noStore },
		)
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
							status === 409
								? ('CONFLICT' as const)
								: status === 404
									? ('NOT_FOUND' as const)
									: status === 403
										? ('FORBIDDEN' as const)
										: status === 401
											? ('UNAUTHENTICATED' as const)
											: status === 400
												? ('INVALID_REQUEST' as const)
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
