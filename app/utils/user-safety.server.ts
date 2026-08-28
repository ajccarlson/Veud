import { type Prisma, type PrismaClient } from '@prisma/client'

type SafetyDb = PrismaClient | Prisma.TransactionClient

/**
 * A member who may appear on a viewer's personalized social surfaces.
 *
 * Keeping this as a relation predicate lets callers enforce mute/block privacy
 * inside their own bounded query. Materializing every excluded member ID and
 * expanding it into `NOT IN (...)` makes request size grow with account age and
 * makes different social surfaces drift on which direction of a block counts.
 */
export function sociallyVisibleUserWhere(
	viewerId: string,
): Prisma.UserWhereInput {
	return {
		// Controls the viewer placed on the candidate.
		safetyControlsReceived: {
			none: { ownerId: viewerId, kind: { in: ['mute', 'block'] } },
		},
		// A block the candidate placed on the viewer is symmetric.
		safetyControlsOwned: {
			none: { targetId: viewerId, kind: 'block' },
		},
	}
}

export async function getUserSafetyState(
	db: SafetyDb,
	ownerId: string,
	targetId: string,
) {
	const [owned, receivedBlock] = await Promise.all([
		db.userSafetyControl.findMany({
			where: { ownerId, targetId },
			select: { kind: true },
		}),
		db.userSafetyControl.findFirst({
			where: { ownerId: targetId, targetId: ownerId, kind: 'block' },
			select: { id: true },
		}),
	])
	const kinds = new Set(owned.map(control => control.kind))
	return {
		isMuted: kinds.has('mute'),
		isBlocked: kinds.has('block'),
		isBlockedByTarget: Boolean(receivedBlock),
	}
}

export async function assertUsersCanInteract(
	db: SafetyDb,
	firstUserId: string,
	secondUserId: string,
) {
	const block = await db.userSafetyControl.findFirst({
		where: {
			kind: 'block',
			OR: [
				{ ownerId: firstUserId, targetId: secondUserId },
				{ ownerId: secondUserId, targetId: firstUserId },
			],
		},
		select: { id: true },
	})
	if (block) throw new Response('Profile not found', { status: 404 })
}

export async function setUserSafetyControl(
	db: SafetyDb,
	input: {
		ownerId: string
		targetId: string
		kind: 'mute' | 'block'
		enabled: boolean
	},
) {
	if (input.ownerId === input.targetId) {
		throw new Response('You cannot apply this control to yourself', {
			status: 400,
		})
	}
	const target = await db.user.findUnique({
		where: { id: input.targetId },
		select: { id: true },
	})
	if (!target) throw new Response('Profile not found', { status: 404 })

	if (input.enabled) {
		await db.userSafetyControl.upsert({
			where: {
				ownerId_targetId_kind: {
					ownerId: input.ownerId,
					targetId: input.targetId,
					kind: input.kind,
				},
			},
			update: {},
			create: {
				ownerId: input.ownerId,
				targetId: input.targetId,
				kind: input.kind,
			},
		})
		if (input.kind === 'block') {
			await db.follow.deleteMany({
				where: {
					OR: [
						{ followerId: input.ownerId, followingId: input.targetId },
						{ followerId: input.targetId, followingId: input.ownerId },
					],
				},
			})
		}
	} else {
		await db.userSafetyControl.deleteMany({
			where: {
				ownerId: input.ownerId,
				targetId: input.targetId,
				kind: input.kind,
			},
		})
	}
	return getUserSafetyState(db, input.ownerId, input.targetId)
}

export async function excludedUserIdsFor(db: SafetyDb, ownerId: string) {
	const controls = await db.userSafetyControl.findMany({
		where: {
			OR: [
				{ ownerId, kind: { in: ['mute', 'block'] } },
				{ targetId: ownerId, kind: 'block' },
			],
		},
		select: { ownerId: true, targetId: true },
	})
	return [
		...new Set(
			controls.map(control =>
				control.ownerId === ownerId ? control.targetId : control.ownerId,
			),
		),
	]
}
