import { useEffect, useState, type ReactNode } from 'react'
import { useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { type action } from '#app/routes/resources+/home-dashboard-preferences.ts'
import {
	HOME_DASHBOARD_LABELS,
	type HomeDashboardConfig,
	type HomeDashboardModule,
} from '#app/utils/home-dashboard.ts'

function preferenceFormData(config: HomeDashboardConfig) {
	const formData = new FormData()
	formData.set('density', config.density)
	for (const module of config.moduleOrder) {
		formData.append('moduleOrder', module)
	}
	for (const module of config.collapsedModules) {
		formData.append('collapsedModules', module)
	}
	return formData
}

export function HomeDashboard({
	initialConfig,
	modules,
}: {
	initialConfig: HomeDashboardConfig
	modules: Record<HomeDashboardModule, ReactNode>
}) {
	const fetcher = useFetcher<typeof action>()
	const [config, setConfig] = useState(initialConfig)

	useEffect(() => setConfig(initialConfig), [initialConfig])

	function save(next: HomeDashboardConfig) {
		setConfig(next)
		void fetcher.submit(preferenceFormData(next), {
			method: 'post',
			action: '/resources/home-dashboard-preferences',
		})
	}

	function toggle(module: HomeDashboardModule) {
		const collapsed = config.collapsedModules.includes(module)
		save({
			...config,
			collapsedModules: collapsed
				? config.collapsedModules.filter(key => key !== module)
				: [...config.collapsedModules, module],
		})
	}

	function move(module: HomeDashboardModule, offset: -1 | 1) {
		const index = config.moduleOrder.indexOf(module)
		const target = index + offset
		if (index < 0 || target < 0 || target >= config.moduleOrder.length) return
		const moduleOrder = [...config.moduleOrder]
		;[moduleOrder[index], moduleOrder[target]] = [
			moduleOrder[target]!,
			moduleOrder[index]!,
		]
		save({ ...config, moduleOrder })
	}

	return (
		<section
			className="home-personal-dashboard"
			data-density={config.density}
			aria-label="Personal home dashboard"
		>
			<details className="home-dashboard-settings">
				<summary>
					<span>
						<strong>Customize home</strong>
						<small>Order, density, and collapsed sections sync to your account.</small>
					</span>
					<span aria-live="polite">
						{fetcher.state === 'idle' ? 'Saved' : 'Saving…'}
					</span>
				</summary>
				<div className="home-dashboard-settings-body">
					<fieldset>
						<legend>Information density</legend>
						<div className="flex flex-wrap gap-2">
							{(['comfortable', 'compact'] as const).map(density => (
								<Button
									key={density}
									type="button"
									size="sm"
									variant={config.density === density ? 'default' : 'outline'}
									aria-pressed={config.density === density}
									onClick={() => save({ ...config, density })}
								>
									{density === 'comfortable' ? 'Comfortable' : 'Compact'}
								</Button>
							))}
						</div>
					</fieldset>
					<fieldset>
						<legend>Module order and visibility</legend>
						<ul className="home-dashboard-module-controls">
							{config.moduleOrder.map((module, index) => {
								const collapsed = config.collapsedModules.includes(module)
								return (
									<li key={module}>
										<span>{HOME_DASHBOARD_LABELS[module]}</span>
										<div>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												disabled={index === 0}
												onClick={() => move(module, -1)}
												aria-label={`Move ${HOME_DASHBOARD_LABELS[module]} earlier`}
											>
												↑
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												disabled={index === config.moduleOrder.length - 1}
												onClick={() => move(module, 1)}
												aria-label={`Move ${HOME_DASHBOARD_LABELS[module]} later`}
											>
												↓
											</Button>
											<Button
												type="button"
												size="sm"
												variant="outline"
												aria-pressed={collapsed}
												onClick={() => toggle(module)}
											>
												{collapsed ? 'Show' : 'Collapse'}
											</Button>
										</div>
									</li>
								)
							})}
						</ul>
					</fieldset>
				</div>
			</details>

			<div className="home-dashboard-grid">
				{config.moduleOrder.map(module => {
					const collapsed = config.collapsedModules.includes(module)
					return (
						<section
							key={module}
							className={`home-dashboard-module home-dashboard-module--${module}`}
							data-collapsed={collapsed}
							aria-label={
								collapsed ? HOME_DASHBOARD_LABELS[module] : undefined
							}
						>
							<div className="home-dashboard-module-toolbar">
								{collapsed ? (
									<h2>{HOME_DASHBOARD_LABELS[module]}</h2>
								) : (
									<span />
								)}
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => toggle(module)}
									aria-expanded={!collapsed}
									aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${HOME_DASHBOARD_LABELS[module]}`}
								>
									{collapsed ? 'Expand' : 'Collapse'}
								</Button>
							</div>
							{collapsed ? null : modules[module]}
						</section>
					)
				})}
			</div>
		</section>
	)
}
