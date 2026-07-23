import { data as json, type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { saveHomeDashboardConfig } from '#app/utils/home-dashboard.server.ts'
import {
	HOME_DASHBOARD_MODULES,
	isHomeDashboardModule,
	type HomeDashboardDensity,
} from '#app/utils/home-dashboard.ts'

const noStore = { headers: { 'Cache-Control': 'private, no-store' } }

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const formData = await request.formData()
	const density = formData.get('density')
	const moduleOrder = formData.getAll('moduleOrder')
	const collapsedModules = formData.getAll('collapsedModules')
	if (
		(density !== 'comfortable' && density !== 'compact') ||
		moduleOrder.length !== HOME_DASHBOARD_MODULES.length ||
		!moduleOrder.every(isHomeDashboardModule) ||
		new Set(moduleOrder).size !== HOME_DASHBOARD_MODULES.length ||
		!collapsedModules.every(isHomeDashboardModule)
	) {
		return json(
			{ ok: false as const, error: 'Invalid dashboard preferences' },
			{ status: 400, ...noStore },
		)
	}
	const config = {
		density: density as HomeDashboardDensity,
		moduleOrder,
		collapsedModules: [...new Set(collapsedModules)],
	}
	await saveHomeDashboardConfig(ownerId, config)
	return json({ ok: true as const, config }, noStore)
}
