import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { cleanupExpiredData } from './retention.server.ts'

test('removes expired private workflow data but preserves active records', async () => {
	const now = new Date('2026-07-25T12:00:00.000Z')
	const user = await prisma.user.create({
		data: {
			email: 'retention@example.com',
			username: 'retention_user',
		},
	})
	await prisma.session.createMany({
		data: [
			{
				userId: user.id,
				expirationDate: new Date(now.getTime() - 1),
			},
			{
				userId: user.id,
				expirationDate: new Date(now.getTime() + 60_000),
			},
		],
	})
	await prisma.aiDiscoverySession.createMany({
		data: [
			{
				ownerId: user.id,
				phrases: 'expired',
				plans: '[]',
				expiresAt: new Date(now.getTime() - 1),
			},
			{
				ownerId: user.id,
				phrases: 'active',
				plans: '[]',
				expiresAt: new Date(now.getTime() + 60_000),
			},
		],
	})

	const result = await cleanupExpiredData(prisma, now)

	expect(result.sessions).toBeGreaterThanOrEqual(1)
	expect(result.aiDiscoverySessions).toBeGreaterThanOrEqual(1)
	expect(
		await prisma.session.count({
			where: { userId: user.id, expirationDate: { gt: now } },
		}),
	).toBe(1)
	expect(
		await prisma.aiDiscoverySession.count({
			where: { ownerId: user.id, expiresAt: { gt: now } },
		}),
	).toBe(1)
})
