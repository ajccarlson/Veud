import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

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

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
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
	const type = await prisma.listType.findUnique({
		where: { id: input.typeId.value },
		select: { id: true },
	})
	if (!type) throw new Response('List type not found', { status: 400 })

	return prisma.$transaction(async tx => {
		const count = await tx.watchlist.count({
			where: { ownerId: userId, typeId: type.id },
		})
		const position = Math.min(input.position.value, count + 1)
		await tx.watchlist.updateMany({
			where: {
    ownerId: userId,
				typeId: type.id,
				position: { gte: position },
			},
			data: { position: { increment: 1 } },
		})
		return tx.watchlist.create({
			data: {
				ownerId: userId,
				typeId: type.id,
				position,
				name: input.name.value,
				header: input.header.value,
				displayedColumns: input.displayedColumns.value,
				description: input.description?.value ?? '',
    isPublic: true,
			},
		})
	})
}
