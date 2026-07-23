import { prisma } from './db.server.ts'
import {
	DEFAULT_HOME_DASHBOARD_CONFIG,
	normalizeHomeDashboardConfig,
	type HomeDashboardConfig,
} from './home-dashboard.ts'

export async function getHomeDashboardConfig(
	ownerId: string | null,
): Promise<HomeDashboardConfig> {
	if (!ownerId) return DEFAULT_HOME_DASHBOARD_CONFIG
	const preference = await prisma.homeDashboardPreference.findUnique({
		where: { ownerId },
		select: {
			density: true,
			moduleOrder: true,
			collapsedModules: true,
		},
	})
	return normalizeHomeDashboardConfig(preference ?? undefined)
}

export async function saveHomeDashboardConfig(
	ownerId: string,
	config: HomeDashboardConfig,
) {
	const data = {
		density: config.density,
		moduleOrder: JSON.stringify(config.moduleOrder),
		collapsedModules: JSON.stringify(config.collapsedModules),
	}
	return prisma.homeDashboardPreference.upsert({
		where: { ownerId },
		create: { ownerId, ...data },
		update: data,
		select: {
			density: true,
			moduleOrder: true,
			collapsedModules: true,
		},
	})
}

export async function getContinuationQueue(ownerId: string) {
	return prisma.trackingState.findMany({
		where: {
			ownerId,
			status: {
				in: [
					'watching',
					'currentlywatching',
					'reading',
					'currentlyreading',
					'in-progress',
					'inprogress',
				],
			},
		},
		select: {
			id: true,
			status: true,
			score: true,
			updatedAt: true,
			progress: {
				select: { unit: true, current: true, total: true },
				orderBy: { unit: 'asc' },
			},
			media: {
				select: {
					id: true,
					kind: true,
					title: true,
					thumbnail: true,
					type: true,
				},
			},
		},
		orderBy: { updatedAt: 'desc' },
		take: 8,
	})
}
