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
})

export async function loader({ request }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request)
	const url = new URL(request.url)
	const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams))
	if (!parsed.success) {
		throw new Response('Invalid consumption history request', { status: 400 })
	}
	const state = await prisma.trackingState.findUnique({
		where: {
			ownerId_mediaId: { ownerId, mediaId: parsed.data.mediaId },
		},
		select: {
			id: true,
			progress: {
				orderBy: { unit: 'asc' },
				select: { unit: true, current: true, total: true, updatedAt: true },
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
					installments: {
						orderBy: [
							{ kind: 'asc' },
							{ seasonNumber: 'asc' },
							{ number: 'asc' },
						],
						take: 2_000,
						select: {
							id: true,
							kind: true,
							seasonNumber: true,
							number: true,
							absoluteNumber: true,
							title: true,
							releasedAt: true,
							consumptionEvents: {
								where: { ownerId },
								orderBy: { consumedAt: 'desc' },
								select: {
									id: true,
									eventType: true,
									repeatNumber: true,
									consumedAt: true,
								},
							},
						},
					},
				},
			},
		},
	})
	if (!state) throw new Response('Not found', { status: 404 })
	return json(
		{ ok: true as const, data: state },
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
