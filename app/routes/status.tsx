import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	incidentStatusLabel,
	parseAffectedAreas,
	serviceAreas,
} from '#app/utils/service-incidents.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: '/status', priority: 0.2 }],
}

export const meta: MetaFunction = () => [
	{ title: 'Service status | Veud' },
	{
		name: 'description',
		content: 'Current Veud service availability and incident history.',
	},
]

export async function loader({}: LoaderFunctionArgs) {
	const historyCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
	const incidents = await prisma.serviceIncident.findMany({
		where: {
			OR: [
				{ status: { not: 'resolved' } },
				{ resolvedAt: { gte: historyCutoff } },
			],
		},
		orderBy: [{ resolvedAt: 'asc' }, { startedAt: 'desc' }],
		take: 25,
		select: {
			id: true,
			title: true,
			summary: true,
			severity: true,
			status: true,
			affectedAreas: true,
			startedAt: true,
			resolvedAt: true,
			events: {
				orderBy: { createdAt: 'desc' },
				take: 20,
				select: {
					id: true,
					status: true,
					message: true,
					createdAt: true,
				},
			},
		},
	})
	return json(
		{
			generatedAt: new Date().toISOString(),
			incidents: incidents.map(incident => ({
				...incident,
				affectedAreas: parseAffectedAreas(incident.affectedAreas),
			})),
		},
		{ headers: { 'Cache-Control': 'no-store' } },
	)
}

const areaLabels = {
	website: 'Website',
	accounts: 'Accounts',
	lists: 'Lists & tracking',
	catalog: 'Catalog',
	search: 'Search & discovery',
	notifications: 'Email & notifications',
} as const

export default function StatusRoute() {
	const { incidents, generatedAt } = useLoaderData<typeof loader>()
	const active = incidents.filter(incident => incident.status !== 'resolved')
	const affected = new Set(active.flatMap(incident => incident.affectedAreas))
	const overall = active.some(incident => incident.severity === 'critical')
		? 'Major outage'
		: active.some(incident => incident.severity === 'major')
			? 'Partial outage'
			: active.length
				? 'Degraded performance'
				: 'All systems operational'
	const overallClass = active.length
		? 'border-amber-300/50 bg-amber-950/25 text-amber-100'
		: 'border-emerald-300/40 bg-emerald-950/25 text-emerald-100'

	return (
		<VeudPage width="narrow">
			<VeudPageHeader
				eyebrow="Reliability"
				title="Service status"
				description={
					<p>
						Current availability and public updates from the Veud operations
						team.
					</p>
				}
			/>
			<section className={`rounded-2xl border p-5 sm:p-6 ${overallClass}`}>
				<p className="text-xs font-black uppercase tracking-[0.18em]">
					Current status
				</p>
				<h2 className="mt-2 text-2xl font-black">{overall}</h2>
				<p className="mt-2 text-xs opacity-80">
					Updated {new Date(generatedAt).toLocaleString()}
				</p>
			</section>

			<section aria-labelledby="services-heading">
				<h2
					id="services-heading"
					className="mb-3 text-xl font-black text-veud-yellow"
				>
					Services
				</h2>
				<ul className="grid gap-3 sm:grid-cols-2">
					{serviceAreas.map(area => (
						<li
							key={area}
							className="flex items-center justify-between gap-4 rounded-2xl border border-veud-border bg-veud-surface p-4"
						>
							<span className="font-black text-veud-cream">
								{areaLabels[area]}
							</span>
							<span
								className={
									affected.has(area)
										? 'text-sm font-black text-amber-200'
										: 'text-sm font-black text-emerald-200'
								}
							>
								{affected.has(area) ? 'Affected' : 'Operational'}
							</span>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="incidents-heading">
				<h2
					id="incidents-heading"
					className="mb-3 text-xl font-black text-veud-yellow"
				>
					Incident history
				</h2>
				{incidents.length ? (
					<ul className="grid gap-4">
						{incidents.map(incident => (
							<li key={incident.id}>
								<VeudPanel>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="text-xs font-black uppercase tracking-[0.16em] text-veud-mint">
												{incident.severity} ·{' '}
												{incidentStatusLabel(incident.status)}
											</p>
											<h3 className="mt-1 text-lg font-black text-veud-cream">
												{incident.title}
											</h3>
										</div>
										<time className="text-xs text-veud-copy">
											{new Date(incident.startedAt).toLocaleString()}
										</time>
									</div>
									<p className="mt-3 text-sm leading-6 text-veud-copy">
										{incident.summary}
									</p>
									<p className="mt-3 text-xs font-bold text-veud-mint">
										{incident.affectedAreas
											.map(area => areaLabels[area])
											.join(' · ')}
									</p>
									<ol className="mt-5 border-l border-veud-border pl-4">
										{incident.events.map(event => (
											<li key={event.id} className="relative pb-4 last:pb-0">
												<span
													className="absolute -left-[1.19rem] top-1 h-2 w-2 rounded-full bg-veud-mint"
													aria-hidden
												/>
												<div className="flex flex-wrap justify-between gap-2">
													<p className="text-sm font-black text-veud-cream">
														{incidentStatusLabel(event.status)}
													</p>
													<time className="text-xs text-veud-copy">
														{new Date(event.createdAt).toLocaleString()}
													</time>
												</div>
												<p className="mt-1 text-sm leading-6 text-veud-copy">
													{event.message}
												</p>
											</li>
										))}
									</ol>
								</VeudPanel>
							</li>
						))}
					</ul>
				) : (
					<VeudPanel tone="dashed">
						<p className="font-black text-veud-cream">
							No incidents in the last 30 days.
						</p>
						<p className="mt-1 text-sm text-veud-copy">
							Veud is operating normally.
						</p>
					</VeudPanel>
				)}
			</section>
		</VeudPage>
	)
}
