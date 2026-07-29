import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	assertWatchlistCreationAllowed,
	WatchlistLimitError,
} from '#app/utils/watchlist-limits.ts'

const wrapped = <T extends z.ZodTypeAny>(value: T) =>
	z.object({ value, type: z.string() })

const CreateWatchlistSchema = z.object({
	position: wrapped(z.number().int().positive().max(10_000)),
	name: wrapped(z.string().trim().min(1).max(100)),
	header: wrapped(z.string().trim().min(1).max(100)),
	typeId: wrapped(z.string().trim().min(1).max(100)),
	displayedColumns: wrapped(z.string().min(1).max(5_000)),
	description: wrapped(z.string().max(5_000)).optional(),
	// Older clients include these fields. The server deliberately ignores them.
	createdAt: wrapped(z.unknown()).optional(),
	updatedAt: wrapped(z.unknown()).optional(),
})

const CreateWatchlistCommandSchema = z.object({
	position: z.number().int().positive().max(10_000).optional(),
	name: z.string().trim().min(1).max(100).optional(),
	header: z.string().trim().min(3).max(100),
	typeId: z.string().trim().min(1).max(100),
	displayedColumns: z.string().min(1).max(5_000).optional(),
	description: z.string().max(5_000).default(''),
	isPublic: z.boolean().default(true),
})

function watchlistSlug(value: string) {
	return (
		value
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80) || 'list'
	)
}

export async function createWatchlistCommand(
	ownerId: string,
	rawInput: unknown,
) {
	const parsed = CreateWatchlistCommandSchema.safeParse(rawInput)
	if (!parsed.success) {
		throw new Response('Invalid list payload', { status: 400 })
	}
	const input = parsed.data
	const type = await prisma.listType.findUnique({
		where: { id: input.typeId },
		select: { id: true, columns: true },
	})
	if (!type) throw new Response('List type not found', { status: 400 })

	try {
		return await prisma.$transaction(async tx => {
			await assertWatchlistCreationAllowed(tx, {
				ownerId,
				typeId: type.id,
			})
			const count = await tx.watchlist.count({
				where: { ownerId, typeId: type.id },
			})
			const position = Math.min(input.position ?? count + 1, count + 1)
			const requestedSlug = watchlistSlug(input.name ?? input.header)
			const existingNames = new Set(
				(
					await tx.watchlist.findMany({
						where: { ownerId, typeId: type.id },
						select: { name: true },
					})
				).map(watchlist => watchlist.name),
			)
			let name = requestedSlug
			for (let suffix = 2; existingNames.has(name); suffix++) {
				name = `${requestedSlug.slice(0, 72)}-${suffix}`
			}
			const displayedColumns =
				input.displayedColumns ??
				Object.keys(JSON.parse(type.columns) as Record<string, unknown>)
					.filter(
						column =>
							column !== 'id' &&
							column !== 'watchlistId' &&
							column !== 'watchlist',
					)
					.join(', ')
			await tx.watchlist.updateMany({
				where: {
					ownerId,
					typeId: type.id,
					position: { gte: position },
				},
				data: { position: { increment: 1 } },
			})
			return tx.watchlist.create({
				data: {
					ownerId,
					typeId: type.id,
					position,
					name,
					header: input.header,
					displayedColumns,
					description: input.description,
					isPublic: input.isPublic,
				},
			})
		})
	} catch (error) {
		if (error instanceof WatchlistLimitError) {
			throw new Response(error.message, { status: error.status })
		}
		throw error
	}
}

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)

	let rawList: unknown
	try {
		rawList = JSON.parse(searchParams.get('list') ?? '')
	} catch {
		throw new Response('Invalid list payload', { status: 400 })
	}
	const parsed = CreateWatchlistSchema.safeParse(rawList)
	if (!parsed.success) {
		throw new Response('Invalid list payload', { status: 400 })
	}
	const input = parsed.data
	return createWatchlistCommand(ownerId, {
		position: input.position.value,
		name: input.name.value,
		header: input.header.value,
		typeId: input.typeId.value,
		displayedColumns: input.displayedColumns.value,
		description: input.description?.value ?? '',
		isPublic: true,
	})
}
