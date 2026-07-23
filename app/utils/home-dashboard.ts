export const HOME_DASHBOARD_MODULES = [
	'trending',
	'continue',
	'recommendations',
	'following',
	'library',
	'upcoming',
] as const

export type HomeDashboardModule = (typeof HOME_DASHBOARD_MODULES)[number]
export type HomeDashboardDensity = 'comfortable' | 'compact'

export type HomeDashboardConfig = {
	density: HomeDashboardDensity
	moduleOrder: HomeDashboardModule[]
	collapsedModules: HomeDashboardModule[]
}

export const DEFAULT_HOME_DASHBOARD_CONFIG: HomeDashboardConfig = {
	density: 'comfortable',
	moduleOrder: [...HOME_DASHBOARD_MODULES],
	collapsedModules: [],
}

export const HOME_DASHBOARD_LABELS: Record<HomeDashboardModule, string> = {
	trending: 'Trending',
	continue: 'Continue',
	recommendations: 'Recommendations',
	following: 'Following activity',
	library: 'Your library',
	upcoming: 'Release alerts',
}

export function isHomeDashboardModule(
	value: unknown,
): value is HomeDashboardModule {
	return HOME_DASHBOARD_MODULES.includes(value as HomeDashboardModule)
}

function parseList(value: string | null | undefined) {
	if (!value) return []
	try {
		const parsed: unknown = JSON.parse(value)
		return Array.isArray(parsed) ? parsed.filter(isHomeDashboardModule) : []
	} catch {
		return []
	}
}

function uniqueModules(values: HomeDashboardModule[]) {
	return [...new Set(values)]
}

export function normalizeHomeDashboardConfig(input?: {
	density?: string | null
	moduleOrder?: string | null
	collapsedModules?: string | null
}): HomeDashboardConfig {
	const order = uniqueModules(parseList(input?.moduleOrder))
	for (const module of HOME_DASHBOARD_MODULES) {
		if (!order.includes(module)) order.push(module)
	}
	return {
		density: input?.density === 'compact' ? 'compact' : 'comfortable',
		moduleOrder: order,
		collapsedModules: uniqueModules(parseList(input?.collapsedModules)),
	}
}
