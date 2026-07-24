import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	Form,
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import {
	aiCapabilities,
	getAiGatewayTelemetry,
	isAiCapabilityConfigured,
} from '#app/utils/ai-gateway.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getRuntimeOperationsSnapshot } from '#app/utils/operations-observability.server.ts'
import { requireUserWithPermission } from '#app/utils/permissions.server.ts'
import {
	createIncidentSchema,
	incidentSeverities,
	incidentStatuses,
	serviceAreas,
	updateIncidentSchema,
} from '#app/utils/service-incidents.ts'
import { useOptionalUser, userHasRole } from '#app/utils/user.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: MetaFunction = () => [
	{ title: 'Site operations | Veud' },
	{
		name: 'description',
		content: 'Private live reliability and release status for Veud operators.',
	},
]

export async function loader({ request, url }: LoaderFunctionArgs) {
	await requireUserWithPermission(request, 'read:operations:any', { url })
	const databaseStartedAt = performance.now()
	let database = {
		status: 'healthy' as 'healthy' | 'critical',
		latencyMs: 0,
		error: null as string | null,
	}
	try {
		await prisma.$queryRaw`SELECT 1`
		database.latencyMs = Number(
			(performance.now() - databaseStartedAt).toFixed(1),
		)
	} catch (error) {
		database = {
			status: 'critical',
			latencyMs: Number((performance.now() - databaseStartedAt).toFixed(1)),
			error: error instanceof Error ? error.name : 'DatabaseError',
		}
	}
	const [runtime, incidents] = await Promise.all([
		Promise.resolve(getRuntimeOperationsSnapshot()),
		prisma.serviceIncident.findMany({
			orderBy: { startedAt: 'desc' },
			take: 20,
			select: {
				id: true,
				title: true,
				status: true,
				severity: true,
				startedAt: true,
				resolvedAt: true,
			},
		}),
	])
	const health =
		database.status === 'critical' || runtime.requests.errorRatePercent >= 5
			? 'critical'
			: runtime.requests.errorRatePercent >= 1 ||
				  runtime.requests.p95Ms >= 1_500
				? 'degraded'
				: 'healthy'
	const aiEvents = getAiGatewayTelemetry()
	const ai = aiCapabilities.map(capability => {
		const events = aiEvents.filter(event => event.capability === capability)
		const durations = events
			.map(event => event.durationMs)
			.sort((left, right) => left - right)
		return {
			capability,
			enabled: isAiCapabilityConfigured(capability),
			requests: events.length,
			successes: events.filter(event => event.outcome === 'success').length,
			fallbacks: events.filter(event => event.outcome !== 'success').length,
			p95Ms: durations.length
				? durations[
						Math.min(
							durations.length - 1,
							Math.ceil(durations.length * 0.95) - 1,
						)
					]!
				: null,
			inputTokens: events.reduce(
				(sum, event) => sum + (event.inputTokens ?? 0),
				0,
			),
			outputTokens: events.reduce(
				(sum, event) => sum + (event.outputTokens ?? 0),
				0,
			),
		}
	})

	return json(
		{
			health,
			runtime,
			database,
			integrations: {
				errorAggregation:
					Boolean(process.env.SENTRY_DSN) &&
					process.env.SENTRY_DSN !== 'your-dsn',
				emailDelivery: Boolean(process.env.RESEND_API_KEY),
				canonicalOrigin: Boolean(process.env.VEUD_ORIGIN),
			},
			incidents,
			ai,
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}

export async function action({ request, url }: ActionFunctionArgs) {
	const actorId = await requireUserWithPermission(
		request,
		'update:operations:any',
		{ url },
	)
	const formData = await request.formData()
	const intent = formData.get('intent')
	if (intent === 'create-incident') {
		const parsed = createIncidentSchema.safeParse({
			title: formData.get('title'),
			summary: formData.get('summary'),
			severity: formData.get('severity'),
			affectedAreas: formData.getAll('affectedAreas'),
		})
		if (!parsed.success) {
			return json(
				{
					ok: false as const,
					error: 'Check the incident fields and try again.',
				},
				400,
			)
		}
		const incident = await prisma.serviceIncident.create({
			data: {
				...parsed.data,
				affectedAreas: JSON.stringify(parsed.data.affectedAreas),
				events: {
					create: {
						status: 'investigating',
						message: parsed.data.summary,
						actorId,
					},
				},
			},
			select: { id: true },
		})
		return json({ ok: true as const, incidentId: incident.id })
	}
	if (intent === 'update-incident') {
		const parsed = updateIncidentSchema.safeParse({
			incidentId: formData.get('incidentId'),
			status: formData.get('status'),
			message: formData.get('message'),
		})
		if (!parsed.success) {
			return json(
				{ ok: false as const, error: 'Check the update fields and try again.' },
				400,
			)
		}
		const existing = await prisma.serviceIncident.findUnique({
			where: { id: parsed.data.incidentId },
			select: { id: true },
		})
		if (!existing) {
			return json({ ok: false as const, error: 'Incident not found.' }, 404)
		}
		await prisma.$transaction([
			prisma.serviceIncident.update({
				where: { id: existing.id },
				data: {
					status: parsed.data.status,
					resolvedAt: parsed.data.status === 'resolved' ? new Date() : null,
				},
			}),
			prisma.serviceIncidentEvent.create({
				data: {
					incidentId: existing.id,
					actorId,
					status: parsed.data.status,
					message: parsed.data.message,
				},
			}),
		])
		return json({ ok: true as const, incidentId: existing.id })
	}
	return json({ ok: false as const, error: 'Unsupported action.' }, 400)
}

function formatDuration(seconds: number) {
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	if (hours < 48) return `${hours}h ${minutes % 60}m`
	return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function Metric({
	label,
	value,
	detail,
}: {
	label: string
	value: string
	detail?: string
}) {
	return (
		<VeudPanel className="min-w-0">
			<p className="text-xs font-black uppercase tracking-[0.16em] text-veud-copy">
				{label}
			</p>
			<p className="mt-2 break-words text-2xl font-black text-veud-cream">
				{value}
			</p>
			{detail ? (
				<p className="mt-1 text-xs leading-5 text-veud-mint">{detail}</p>
			) : null}
		</VeudPanel>
	)
}

export default function OperationsAdminRoute() {
	const snapshot = useLoaderData<typeof loader>()
	const user = useOptionalUser()
	const { runtime } = snapshot
	const healthClass =
		snapshot.health === 'healthy'
			? 'border-emerald-300/40 bg-emerald-950/25 text-emerald-100'
			: snapshot.health === 'degraded'
				? 'border-amber-300/50 bg-amber-950/25 text-amber-100'
				: 'border-red-300/50 bg-red-950/30 text-red-100'

	return (
		<VeudPage width="wide">
			<VeudPageHeader
				eyebrow="Administration"
				title="Site operations"
				description={
					<p>
						Live process, request, database, integration, and release telemetry.
						Query strings and client addresses are excluded.
					</p>
				}
				actions={
					<div className="flex flex-wrap gap-2">
						{userHasRole(user ?? null, 'admin') ? (
							<Link
								to="/admin/catalog"
								className="inline-flex min-h-11 items-center rounded-xl border border-veud-border bg-veud-canvas px-4 font-black text-veud-copy hover:border-veud-mint hover:text-veud-mint"
							>
								Catalog status
							</Link>
						) : null}
						<Link
							to="."
							reloadDocument
							className="inline-flex min-h-11 items-center rounded-xl border border-veud-mint/50 bg-veud-canvas px-4 font-black text-veud-mint hover:border-veud-mint"
						>
							Refresh
						</Link>
					</div>
				}
			/>

			<section className={`rounded-2xl border p-5 sm:p-6 ${healthClass}`}>
				<p className="text-xs font-black uppercase tracking-[0.18em]">
					Overall readiness
				</p>
				<div className="mt-2 flex flex-wrap items-end justify-between gap-3">
					<h2 className="text-2xl font-black capitalize">{snapshot.health}</h2>
					<p className="text-xs font-semibold">
						Release {runtime.release} · {runtime.environment}
					</p>
				</div>
			</section>

			<section aria-labelledby="request-health-heading">
				<h2
					id="request-health-heading"
					className="mb-3 text-xl font-black text-veud-yellow"
				>
					Request health
				</h2>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<Metric
						label="Recent p95"
						value={`${runtime.requests.p95Ms} ms`}
						detail={`${runtime.requests.sampleSize} response sample`}
					/>
					<Metric
						label="Server errors"
						value={`${runtime.requests.errorRatePercent}%`}
						detail={`${runtime.requests.statuses['5xx']} of ${runtime.requests.completed} completed`}
					/>
					<Metric
						label="In flight"
						value={String(runtime.requests.inFlight)}
						detail={`${runtime.requests.total} since process start`}
					/>
					<Metric
						label="Uptime"
						value={formatDuration(runtime.uptimeSeconds)}
						detail={`Started ${new Date(runtime.startedAt).toLocaleString()}`}
					/>
				</div>
			</section>

			<section
				aria-labelledby="dependencies-heading"
				className="grid gap-3 lg:grid-cols-2"
			>
				<VeudPanel>
					<h2
						id="dependencies-heading"
						className="text-xl font-black text-veud-yellow"
					>
						Dependencies
					</h2>
					<dl className="mt-4 grid gap-3 text-sm">
						<div className="flex justify-between gap-4">
							<dt className="text-veud-copy">Database</dt>
							<dd className="font-black capitalize text-veud-cream">
								{snapshot.database.status} · {snapshot.database.latencyMs} ms
							</dd>
						</div>
						{Object.entries(snapshot.integrations).map(([name, enabled]) => (
							<div key={name} className="flex justify-between gap-4">
								<dt className="text-veud-copy">
									{name.replace(/([A-Z])/g, ' $1')}
								</dt>
								<dd className="font-black text-veud-cream">
									{enabled ? 'Configured' : 'Not configured'}
								</dd>
							</div>
						))}
					</dl>
				</VeudPanel>
				<VeudPanel>
					<h2 className="text-xl font-black text-veud-yellow">Process</h2>
					<dl className="mt-4 grid gap-3 text-sm">
						<div className="flex justify-between gap-4">
							<dt className="text-veud-copy">Node</dt>
							<dd className="font-black text-veud-cream">
								{runtime.process.node}
							</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-veud-copy">Resident memory</dt>
							<dd className="font-black text-veud-cream">
								{runtime.process.residentMemoryMb} MB
							</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-veud-copy">Heap used</dt>
							<dd className="font-black text-veud-cream">
								{runtime.process.heapUsedMb} MB
							</dd>
						</div>
					</dl>
				</VeudPanel>
			</section>

			<VeudPanel aria-labelledby="ai-operations-heading">
				<div>
					<h2
						id="ai-operations-heading"
						className="text-xl font-black text-veud-yellow"
					>
						AI capability health
					</h2>
					<p className="mt-1 text-sm text-veud-copy">
						Process-local, privacy-safe telemetry only: capability, outcome,
						latency, and token counts. Prompts, drafts, reports, and images are
						never logged here. Set VEUD_AI_ENABLED=false for the global kill
						switch.
					</p>
				</div>
				<div className="mt-4 overflow-x-auto">
					<table className="w-full min-w-[680px] text-left text-sm">
						<thead className="text-xs uppercase tracking-wide text-veud-mint">
							<tr>
								{[
									'Capability',
									'State',
									'Requests',
									'Success',
									'Fallback',
									'p95',
									'Tokens in / out',
								].map(label => (
									<th key={label} className="px-3 py-2">
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-veud-border/60">
							{snapshot.ai.map(item => (
								<tr key={item.capability}>
									<td className="px-3 py-2 font-black text-veud-cream">
										{item.capability.replaceAll('-', ' ')}
									</td>
									<td className="px-3 py-2">
										{item.enabled ? 'enabled' : 'disabled'}
									</td>
									<td className="px-3 py-2">{item.requests}</td>
									<td className="px-3 py-2">{item.successes}</td>
									<td className="px-3 py-2">{item.fallbacks}</td>
									<td className="px-3 py-2">
										{item.p95Ms === null ? '—' : `${item.p95Ms} ms`}
									</td>
									<td className="px-3 py-2">
										{item.inputTokens} / {item.outputTokens}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</VeudPanel>

			<VeudPanel aria-labelledby="recent-errors-heading">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2
							id="recent-errors-heading"
							className="text-xl font-black text-veud-yellow"
						>
							Recent server errors
						</h2>
						<p className="mt-1 text-sm text-veud-copy">
							Last {runtime.recentErrors.length} captured process errors.
						</p>
					</div>
					<p className="text-xs text-veud-copy">
						Snapshot {new Date(runtime.generatedAt).toLocaleString()}
					</p>
				</div>
				{runtime.recentErrors.length ? (
					<ul className="mt-4 grid gap-3">
						{runtime.recentErrors.map(error => (
							<li
								key={`${error.at}-${error.requestId}`}
								className="rounded-xl border border-veud-border bg-black/15 p-3"
							>
								<div className="flex flex-wrap justify-between gap-2 text-xs">
									<p className="font-black text-veud-cream">
										{error.status} {error.method} {error.path}
									</p>
									<time className="text-veud-copy">
										{new Date(error.at).toLocaleString()}
									</time>
								</div>
								<p className="mt-1 text-sm text-veud-copy">
									{error.name}: {error.message}
								</p>
								<code className="mt-2 block break-all text-xs text-veud-mint">
									{error.requestId}
								</code>
							</li>
						))}
					</ul>
				) : (
					<p className="mt-4 rounded-xl border border-dashed border-veud-border p-5 text-sm text-veud-mint">
						No process errors have been captured since this server started.
					</p>
				)}
			</VeudPanel>

			<section aria-labelledby="incidents-heading" className="space-y-4">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<h2
							id="incidents-heading"
							className="text-xl font-black text-veud-yellow"
						>
							Public incident status
						</h2>
						<p className="mt-1 text-sm text-veud-copy">
							Every update is appended to the public incident timeline.
						</p>
					</div>
					<Link
						to="/status"
						className="font-black text-veud-mint underline-offset-4 hover:underline"
					>
						View public status
					</Link>
				</div>
				<div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
					<VeudPanel>
						<h3 className="text-base font-black text-veud-cream">
							Open an incident
						</h3>
						<Form method="post" className="mt-4 grid gap-3">
							<input type="hidden" name="intent" value="create-incident" />
							<label className="grid gap-1 text-sm font-bold text-veud-copy">
								Title
								<input
									name="title"
									required
									minLength={3}
									maxLength={120}
									className="min-h-11 rounded-xl border border-veud-border bg-black/20 px-3 text-veud-cream"
								/>
							</label>
							<label className="grid gap-1 text-sm font-bold text-veud-copy">
								Public summary
								<textarea
									name="summary"
									required
									minLength={3}
									maxLength={1000}
									rows={4}
									className="rounded-xl border border-veud-border bg-black/20 p-3 text-veud-cream"
								/>
							</label>
							<label className="grid gap-1 text-sm font-bold text-veud-copy">
								Severity
								<select
									name="severity"
									className="min-h-11 rounded-xl border border-veud-border bg-veud-canvas px-3 text-veud-cream"
								>
									{incidentSeverities.map(severity => (
										<option key={severity} value={severity}>
											{severity}
										</option>
									))}
								</select>
							</label>
							<fieldset>
								<legend className="text-sm font-bold text-veud-copy">
									Affected services
								</legend>
								<div className="mt-2 grid grid-cols-2 gap-2">
									{serviceAreas.map(area => (
										<label
											key={area}
											className="flex min-h-11 items-center gap-2 rounded-xl border border-veud-border bg-black/15 px-3 text-sm capitalize text-veud-copy"
										>
											<input
												type="checkbox"
												name="affectedAreas"
												value={area}
											/>
											{area}
										</label>
									))}
								</div>
							</fieldset>
							<button
								type="submit"
								className="min-h-11 rounded-xl border border-amber-300/50 bg-amber-950/30 px-4 font-black text-amber-100 hover:border-amber-200"
							>
								Publish incident
							</button>
						</Form>
					</VeudPanel>

					<VeudPanel>
						<h3 className="text-base font-black text-veud-cream">
							Recent incidents
						</h3>
						{snapshot.incidents.length ? (
							<ul className="mt-4 grid gap-3">
								{snapshot.incidents.map(incident => (
									<li
										key={incident.id}
										className="rounded-xl border border-veud-border bg-black/15 p-3"
									>
										<div className="flex flex-wrap justify-between gap-2">
											<div>
												<p className="font-black text-veud-cream">
													{incident.title}
												</p>
												<p className="text-xs capitalize text-veud-mint">
													{incident.severity} · {incident.status}
												</p>
											</div>
											<time className="text-xs text-veud-copy">
												{new Date(incident.startedAt).toLocaleString()}
											</time>
										</div>
										<Form method="post" className="mt-3 grid gap-2">
											<input
												type="hidden"
												name="intent"
												value="update-incident"
											/>
											<input
												type="hidden"
												name="incidentId"
												value={incident.id}
											/>
											<div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
												<select
													name="status"
													defaultValue={incident.status}
													className="min-h-11 rounded-xl border border-veud-border bg-veud-canvas px-3 text-sm text-veud-cream"
												>
													{incidentStatuses.map(status => (
														<option key={status} value={status}>
															{status}
														</option>
													))}
												</select>
												<input
													name="message"
													required
													minLength={3}
													maxLength={1000}
													placeholder="Public update"
													className="min-h-11 rounded-xl border border-veud-border bg-black/20 px-3 text-sm text-veud-cream"
												/>
											</div>
											<button
												type="submit"
												className="min-h-11 rounded-xl border border-veud-mint/40 px-3 text-sm font-black text-veud-mint hover:border-veud-mint"
											>
												Publish update
											</button>
										</Form>
									</li>
								))}
							</ul>
						) : (
							<p className="mt-4 text-sm text-veud-copy">
								No incidents have been published.
							</p>
						)}
					</VeudPanel>
				</div>
			</section>
		</VeudPage>
	)
}
