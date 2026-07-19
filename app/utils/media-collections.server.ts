import { invariantResponse } from '@epic-web/invariant'
import { type Prisma } from '@prisma/client'
import { requireUserId } from './auth.server.ts'
import { prisma } from './db.server.ts'

export async function requireCollectionOwner(
	request: Request,
	collectionId: string | undefined,
) {
	const ownerId = await requireUserId(request)
	invariantResponse(collectionId, 'Collection not found', { status: 404 })
	const collection = await prisma.mediaCollection.findFirst({
		where: { id: collectionId, ownerId },
		select: { id: true, ownerId: true },
	})
	invariantResponse(collection, 'Collection not found', { status: 404 })
	return collection
}

export function visibleCollectionWhere(
	collectionId: string,
	viewerId: string | null,
): Prisma.MediaCollectionWhereInput {
	return {
		id: collectionId,
		OR: [{ isPublic: true }, ...(viewerId ? [{ ownerId: viewerId }] : [])],
	}
}

export async function addCollectionItem({
	collectionId,
	mediaId,
}: {
	collectionId: string
	mediaId: string
}) {
	return prisma.$transaction(async transaction => {
		const media = await transaction.media.findUnique({
			where: { id: mediaId },
			select: { id: true },
		})
		invariantResponse(media, 'Media not found', { status: 404 })

		const existing = await transaction.mediaCollectionItem.findUnique({
			where: { collectionId_mediaId: { collectionId, mediaId } },
			select: { id: true },
		})
		if (existing) return { id: existing.id, created: false }

		const highest = await transaction.mediaCollectionItem.aggregate({
			where: { collectionId },
			_max: { position: true },
		})
		const item = await transaction.mediaCollectionItem.create({
			data: {
				collectionId,
				mediaId,
				position: (highest._max.position ?? 0) + 1,
			},
			select: { id: true },
		})
		await transaction.mediaCollection.update({
			where: { id: collectionId },
			data: { updatedAt: new Date() },
		})
		return { id: item.id, created: true }
	})
}

export async function removeCollectionItem({
	collectionId,
	itemId,
}: {
	collectionId: string
	itemId: string
}) {
	return prisma.$transaction(async transaction => {
		const removed = await transaction.mediaCollectionItem.deleteMany({
			where: { id: itemId, collectionId },
		})
		invariantResponse(removed.count === 1, 'Collection item not found', {
			status: 404,
		})
		const items = await transaction.mediaCollectionItem.findMany({
			where: { collectionId },
			select: { id: true },
			orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		})
		await Promise.all(
			items.map((item, index) =>
				transaction.mediaCollectionItem.update({
					where: { id: item.id },
					data: { position: index + 1 },
				}),
			),
		)
		await transaction.mediaCollection.update({
			where: { id: collectionId },
			data: { updatedAt: new Date() },
		})
	})
}

export async function moveCollectionItem({
	collectionId,
	itemId,
	direction,
}: {
	collectionId: string
	itemId: string
	direction: 'up' | 'down'
}) {
	return prisma.$transaction(async transaction => {
		const items = await transaction.mediaCollectionItem.findMany({
			where: { collectionId },
			select: { id: true },
			orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		})
		const index = items.findIndex(item => item.id === itemId)
		invariantResponse(index >= 0, 'Collection item not found', { status: 404 })
		const targetIndex = direction === 'up' ? index - 1 : index + 1
		if (targetIndex < 0 || targetIndex >= items.length) return false

		const orderedIds = items.map(item => item.id)
		const [movedId] = orderedIds.splice(index, 1)
		invariantResponse(movedId, 'Collection item not found', { status: 404 })
		orderedIds.splice(targetIndex, 0, movedId)
		await Promise.all(
			orderedIds.map((id, nextIndex) =>
				transaction.mediaCollectionItem.update({
					where: { id },
					data: { position: nextIndex + 1 },
				}),
			),
		)
		await transaction.mediaCollection.update({
			where: { id: collectionId },
			data: { updatedAt: new Date() },
		})
		return true
	})
}
