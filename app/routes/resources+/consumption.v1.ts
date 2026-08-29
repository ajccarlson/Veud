import { Prisma } from '@prisma/client'
import {
	data as json,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
} from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { recordInstallmentConsumption } from '#app/utils/consumption.server.ts'
import { prisma } from '#app/utils/db.server.ts'

const CheckInSchema = z.object({
	mediaId: z.string().trim().min(1).max(100),
	unit: z.enum(['episode', 'chapter', 'volume']),
	number: z.number().int().positive().max(1_000_000),
	seasonNumber: z.number().int().min(0).max(10_000).optional(),
	absoluteNumber: z
		.number()
		.int()
		.positive()
		.max(1_000_000)
		.nullable()
		.optional(),
	consumedAt: z.string().datetime().optional(),
})

const QuerySchema = z.object({
	mediaId: z.string().trim().min(1).max(100),
	take: z.coerce.number().int().min(1).max(250).default(100),
	cursor: z.string().trim().min(1).max(100).optional(),
	unit: z.enum(['episode', 'chapter', 'volume']).optional(),
	seasonNumber: z.coerce.number().int().min(0).max(10_000).optional(),
})

const CONSUMPTION_EVENTS_PER_INSTALLMENT = 20

type ConsumptionEventPageRow = {
	id: string
	eventType: string
	repeatNumber: number
	consumedAt: Date
	installmentId: string
}

export async function loader({ request }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request)
	const url = new URL(request.url)
	const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams))
	if (!parsed.success) {
		throw new Response('Invalid consumption history request', { status: 400 })
	}
	const isolationLevel = process.env.DATABASE_URL?.startsWith('postgres')
		? ('RepeatableRead' as Prisma.TransactionIsolationLevel)
		: ('Serializable' as Prisma.TransactionIsolationLevel)
	const { state, rows, hasMore, eventRows } = await prisma.$transaction(
		async tx => {
			const trackingState = await tx.trackingState.findUnique({
				where: {
					ownerId_mediaId: { ownerId, mediaId: parsed.data.mediaId },
				},
				select: {
					id: true,
					progress: {
						orderBy: { unit: 'asc' },
						select: {
							unit: true,
							current: true,
							total: true,
							updatedAt: true,
						},
					},
					media: {
						select: {
							id: true,
							kind: true,
							seasons: {
								orderBy: { number: 'asc' },
								select: {
									id: true,
									number: true,
									title: true,
									installmentCount: true,
								},
							},
						},
					},
				},
			})
			if (!trackingState) throw new Response('Not found', { status: 404 })

			const cursorInstallment = parsed.data.cursor
				? await tx.mediaInstallment.findUnique({
						where: { id: parsed.data.cursor },
						select: {
							id: true,
							mediaId: true,
							kind: true,
							seasonNumber: true,
							number: true,
						},
					})
				: null
			if (
				parsed.data.cursor &&
				(!cursorInstallment ||
					cursorInstallment.mediaId !== trackingState.media.id ||
					(parsed.data.unit !== undefined &&
						cursorInstallment.kind !== parsed.data.unit) ||
					(parsed.data.seasonNumber !== undefined &&
						cursorInstallment.seasonNumber !== parsed.data.seasonNumber))
			) {
				throw new Response('Invalid consumption history cursor', {
					status: 400,
				})
			}

			const installmentCandidates = await tx.mediaInstallment.findMany({
				where: {
					mediaId: trackingState.media.id,
					...(parsed.data.unit ? { kind: parsed.data.unit } : {}),
					...(parsed.data.seasonNumber === undefined
						? {}
						: { seasonNumber: parsed.data.seasonNumber }),
					...(cursorInstallment
						? {
								OR: [
									{ kind: { gt: cursorInstallment.kind } },
									{
										kind: cursorInstallment.kind,
										seasonNumber: { gt: cursorInstallment.seasonNumber },
									},
									{
										kind: cursorInstallment.kind,
										seasonNumber: cursorInstallment.seasonNumber,
										number: { gt: cursorInstallment.number },
									},
								],
							}
						: {}),
				},
				orderBy: [{ kind: 'asc' }, { seasonNumber: 'asc' }, { number: 'asc' }],
				take: parsed.data.take + 1,
				select: {
					id: true,
					kind: true,
					seasonNumber: true,
					number: true,
					absoluteNumber: true,
					title: true,
					releasedAt: true,
				},
			})
			const pageHasMore = installmentCandidates.length > parsed.data.take
			const installments = pageHasMore
				? installmentCandidates.slice(0, parsed.data.take)
				: installmentCandidates
			const installmentIds = installments.map(installment => installment.id)
			const consumptionEvents = installmentIds.length
				? await tx.$queryRaw<ConsumptionEventPageRow[]>(Prisma.sql`
						SELECT
							"id",
							"eventType",
							"repeatNumber",
							"consumedAt",
							"installmentId"
						FROM (
							SELECT
								"id",
								"eventType",
								"repeatNumber",
								"consumedAt",
								"installmentId",
								ROW_NUMBER() OVER (
									PARTITION BY "installmentId"
									ORDER BY "consumedAt" DESC, "id" DESC
								) AS "eventRank"
							FROM "ConsumptionEvent"
							WHERE "ownerId" = ${ownerId}
								AND "mediaId" = ${trackingState.media.id}
								AND "installmentId" IN (${Prisma.join(installmentIds)})
						) AS "rankedEvents"
						WHERE "eventRank" <= ${CONSUMPTION_EVENTS_PER_INSTALLMENT + 1}
						ORDER BY "installmentId" ASC, "consumedAt" DESC, "id" DESC
					`)
				: []
			return {
				state: trackingState,
				rows: installments,
				hasMore: pageHasMore,
				eventRows: consumptionEvents,
			}
		},
		{ isolationLevel },
	)
	const eventsByInstallment = new Map<
		string,
		Array<Omit<ConsumptionEventPageRow, 'installmentId'>>
	>()
	for (const { installmentId, ...event } of eventRows) {
		const events = eventsByInstallment.get(installmentId) ?? []
		events.push(event)
		eventsByInstallment.set(installmentId, events)
	}
	const installments = rows.map(row => {
		const events = eventsByInstallment.get(row.id) ?? []
		const eventsTruncated = events.length > CONSUMPTION_EVENTS_PER_INSTALLMENT
		return {
			...row,
			consumptionEvents: eventsTruncated
				? events.slice(0, CONSUMPTION_EVENTS_PER_INSTALLMENT)
				: events,
			consumptionEventsTruncated: eventsTruncated,
		}
	})
	return json(
		{
			ok: true as const,
			data: {
				...state,
				media: { ...state.media, installments },
			},
			pagination: {
				nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
				truncated: hasMore,
			},
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new Response('Check-ins require application/json', { status: 415 })
	}
	const parsed = CheckInSchema.safeParse(await request.json().catch(() => null))
	if (!parsed.success) {
		throw new Response('Invalid check-in', { status: 400 })
	}
	const result = await prisma.$transaction(tx =>
		recordInstallmentConsumption(tx, {
			ownerId,
			...parsed.data,
			consumedAt: parsed.data.consumedAt
				? new Date(parsed.data.consumedAt)
				: undefined,
		}),
	)
	return json({ ok: true as const, data: result })
}
