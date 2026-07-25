import { type PrismaClient } from '@prisma/client'

const DAY = 24 * 60 * 60 * 1_000

export async function cleanupExpiredData(
	prisma: PrismaClient,
	now = new Date(),
) {
	const abandonedImportCutoff = new Date(now.getTime() - 30 * DAY)
	const rolledBackImportCutoff = new Date(now.getTime() - 90 * DAY)

	return prisma.$transaction(async transaction => {
		const [
			sessions,
			verifications,
			aiDiscoverySessions,
			trackingCommandPreviews,
			moderationAppealDrafts,
			abandonedImports,
			rolledBackImports,
		] = await Promise.all([
			transaction.session.deleteMany({
				where: { expirationDate: { lte: now } },
			}),
			transaction.verification.deleteMany({
				where: { expiresAt: { not: null, lte: now } },
			}),
			transaction.aiDiscoverySession.deleteMany({
				where: { expiresAt: { lte: now } },
			}),
			transaction.trackingCommandPreview.deleteMany({
				where: { expiresAt: { lte: now } },
			}),
			transaction.moderationAppealDraft.deleteMany({
				where: { expiresAt: { lte: now } },
			}),
			transaction.libraryImportBatch.deleteMany({
				where: {
					status: { in: ['previewed', 'applying', 'rolling_back'] },
					updatedAt: { lte: abandonedImportCutoff },
				},
			}),
			transaction.libraryImportBatch.deleteMany({
				where: {
					status: 'rolled_back',
					updatedAt: { lte: rolledBackImportCutoff },
				},
			}),
		])

		return {
			sessions: sessions.count,
			verifications: verifications.count,
			aiDiscoverySessions: aiDiscoverySessions.count,
			trackingCommandPreviews: trackingCommandPreviews.count,
			moderationAppealDrafts: moderationAppealDrafts.count,
			libraryImportBatches: abandonedImports.count + rolledBackImports.count,
		}
	})
}
