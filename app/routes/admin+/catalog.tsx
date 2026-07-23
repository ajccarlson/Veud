import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { getCatalogOperationsSnapshot } from '#app/utils/catalog-operations.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: MetaFunction = () => [
	{ title: 'Catalog operations | Veud' },
	{
		name: 'description',
		content: 'Private operational status for Veud catalog synchronization.',
	},
]

export async function loader({ request, url }: LoaderFunctionArgs) {
	await requireUserWithRole(request, 'admin', { url })
	const snapshot = await getCatalogOperationsSnapshot(prisma)
	return json(snapshot, {
		headers: { 'Cache-Control': 'private, no-store' },
	})
}

const healthTone = {
	healthy: 'border-emerald-300/40 bg-emerald-950/30 text-emerald-100',
	degraded: 'border-amber-300/50 bg-amber-950/30 text-amber-100',
	critical: 'border-red-300/50 bg-red-950/35 text-red-100',
	uninitialized: 'border-veud-border bg-veud-canvas text-veud-copy',
} as const

const statusDot = {
	healthy: 'bg-emerald-300',
	degraded: 'bg-amber-300',
	critical: 'bg-red-300',
	uninitialized: 'bg-veud-copy',
} as const

function formatNumber(value: number) {
	return new Intl.NumberFormat('en-US').format(value)
}

function formatDate(value: string | Date | null) {
	if (!value) return '—'
	return `${new Date(value).toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

function coverageTone(value: number) {
	if (value >= 95) return 'bg-emerald-300'
	if (value >= 50) return 'bg-veud-yellow'
	return 'bg-veud-amber'
}

function StatusPill({ status }: { status: string }) {
	const normalized =
		status === 'completed'
			? 'Completed'
			: status === 'running'
				? 'Running'
				: status === 'failed'
					? 'Failed'
					: status
	return (
		<span
			className={cn(
				'inline-flex rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-wider',
				status === 'completed'
					? 'border-emerald-300/30 bg-emerald-950/30 text-emerald-200'
					: status === 'running'
						? 'border-sky-300/30 bg-sky-950/30 text-sky-200'
						: status === 'failed'
							? 'border-red-300/40 bg-red-950/30 text-red-200'
							: 'border-veud-border text-veud-copy',
			)}
		>
			{normalized}
		</span>
	)
}

export default function CatalogAdminRoute() {
	const snapshot = useLoaderData<typeof loader>()
	const health = snapshot.health
	const totalActive = snapshot.coverage.reduce(
		(sum, item) => sum + item.active,
		0,
	)
	const totalHydrated = snapshot.coverage.reduce(
		(sum, item) => sum + item.hydrated,
		0,
	)
	const totalQueue = snapshot.coverage.reduce(
		(sum, item) => sum + item.queueDepth,
		0,
	)
	const activeRuns = snapshot.runs.filter(run => run.status === 'running')

	return (
		<VeudPage width="wide">
			<VeudPageHeader
				eyebrow="Administration"
				title="Catalog operations"
				description={
					<p>
						Coverage, freshness, queues, worker checkpoints, and provider
						pressure from the database serving this route.
					</p>
				}
				actions={
					<Link
						to="."
						reloadDocument
						className="inline-flex min-h-11 items-center justify-center rounded-xl border border-veud-mint/50 bg-veud-canvas px-4 font-black text-veud-mint transition hover:border-veud-mint hover:bg-veud-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-veud-mint"
					>
						Refresh snapshot
					</Link>
				}
			/>

			<section
				aria-label="Catalog health"
				className={cn(
					'rounded-2xl border p-5 sm:p-6',
					healthTone[health.status],
				)}
			>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="space-y-2">
						<p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em]">
							<span
								className={cn(
									'h-2.5 w-2.5 rounded-full',
									statusDot[health.status],
								)}
								aria-hidden
							/>
							{health.status}
						</p>
						<h2 className="text-xl font-black sm:text-2xl">{health.summary}</h2>
					</div>
					<p className="text-xs font-semibold opacity-80">
						Snapshot {formatDate(snapshot.generatedAt)}
					</p>
				</div>
				{health.issues.length ? (
					<ul className="mt-5 grid gap-3 lg:grid-cols-2">
						{health.issues.map(item => (
							<li
								key={item.id}
								className="border-current/20 rounded-xl border bg-black/15 p-4"
							>
								<p className="text-sm font-black">{item.title}</p>
								<p className="mt-1 text-sm leading-6 opacity-90">
									{item.detail}
								</p>
							</li>
						))}
					</ul>
				) : null}
			</section>

			<section
				aria-label="Catalog totals"
				className="grid grid-cols-2 gap-3 lg:grid-cols-4"
			>
				{[
					['Active identities', totalActive],
					['Hydrated details', totalHydrated],
					['Eligible queue', totalQueue],
					['Active workers', activeRuns.length],
				].map(([label, value]) => (
					<VeudPanel key={label} className="min-w-0">
						<p className="text-xs font-black uppercase tracking-[0.15em] text-veud-mint">
							{label}
						</p>
						<p className="mt-2 truncate text-2xl font-black text-veud-cream sm:text-3xl">
							{formatNumber(Number(value))}
						</p>
					</VeudPanel>
				))}
			</section>

			<section aria-labelledby="coverage-heading" className="space-y-4">
				<div>
					<h2
						id="coverage-heading"
						className="text-2xl font-black text-veud-amber"
					>
						Coverage and queue
					</h2>
					<p className="mt-1 text-sm leading-6 text-veud-copy">
						Freshness follows each source record’s persisted refresh deadline.
					</p>
				</div>
				<div className="grid gap-4 md:grid-cols-2">
					{snapshot.coverage.map(item => (
						<VeudPanel
							key={`${item.provider}:${item.kind}`}
							aria-label={item.label}
							className="space-y-5"
						>
							<div className="flex items-start justify-between gap-3">
								<div>
									<p className="text-xs font-black uppercase tracking-[0.18em] text-veud-mint">
										{item.provider}
									</p>
									<h3 className="mt-1 text-xl font-black text-veud-cream">
										{item.label}
									</h3>
								</div>
								<p className="text-right text-sm font-bold text-veud-copy">
									{formatNumber(item.hydrated)} / {formatNumber(item.active)}
								</p>
							</div>
							<div>
								<div className="mb-2 flex justify-between gap-3 text-sm font-bold text-veud-copy">
									<span>Detail coverage</span>
									<span>{item.coveragePercent}%</span>
								</div>
								<div className="h-2 overflow-hidden rounded-full bg-black/35">
									<div
										className={cn(
											'h-full rounded-full transition-[width]',
											coverageTone(item.coveragePercent),
										)}
										style={{
											width: `${Math.min(100, item.coveragePercent)}%`,
										}}
									/>
								</div>
							</div>
							<dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
								{[
									['Fresh', item.fresh],
									['Eligible', item.queueDepth],
									['Prioritized', item.highPriority],
									['Deferred', item.failedDeferred],
									['Tombstoned', item.tombstoned],
									['429 events', item.rateLimitEvents],
								].map(([label, value]) => (
									<div key={label} className="min-w-0">
										<dt className="truncate text-veud-mint">{label}</dt>
										<dd className="mt-0.5 font-black text-veud-cream">
											{formatNumber(Number(value))}
										</dd>
									</div>
								))}
							</dl>
						</VeudPanel>
					))}
				</div>
			</section>

			<VeudPanel aria-labelledby="runs-heading" className="overflow-hidden p-0">
				<div className="border-b border-veud-border px-4 py-4 sm:px-5">
					<h2 id="runs-heading" className="text-xl font-black text-veud-amber">
						Recent sync runs
					</h2>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[860px] text-left text-sm">
						<thead className="bg-black/20 text-xs uppercase tracking-wider text-veud-mint">
							<tr>
								{[
									'Job',
									'Status',
									'Handled',
									'Failed',
									'Requests',
									'429s',
									'Heartbeat',
								].map(label => (
									<th key={label} scope="col" className="px-4 py-3 font-black">
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-veud-border/70">
							{snapshot.runs.length ? (
								snapshot.runs.map(run => (
									<tr key={run.id} className="align-top text-veud-copy">
										<td className="px-4 py-3">
											<p className="font-black text-veud-cream">
												{run.provider}/{run.kind}
											</p>
											<p className="mt-0.5 text-xs uppercase tracking-wide">
												{run.mode}
											</p>
										</td>
										<td className="px-4 py-3">
											<StatusPill status={run.status} />
										</td>
										<td className="px-4 py-3 font-bold">
											{formatNumber(run.recordsHandled)}
										</td>
										<td className="px-4 py-3 font-bold">
											{formatNumber(run.recordsFailed)}
										</td>
										<td className="px-4 py-3 font-bold">
											{formatNumber(run.requestsMade)}
										</td>
										<td className="px-4 py-3 font-bold">
											{formatNumber(run.rateLimitEvents)}
										</td>
										<td className="px-4 py-3 text-xs">
											{formatDate(run.heartbeatAt)}
											{run.lastError ? (
												<p className="mt-2 max-w-sm text-red-200">
													{run.lastError}
												</p>
											) : null}
										</td>
									</tr>
								))
							) : (
								<tr>
									<td
										colSpan={7}
										className="px-4 py-10 text-center text-veud-copy"
									>
										No sync runs are recorded in this database.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</VeudPanel>

			<VeudPanel aria-labelledby="cursors-heading" className="space-y-4">
				<h2 id="cursors-heading" className="text-xl font-black text-veud-amber">
					Durable cursors and leases
				</h2>
				{snapshot.cursors.length ? (
					<ul className="grid gap-3 md:grid-cols-2">
						{snapshot.cursors.map(cursor => (
							<li
								key={cursor.id}
								className="rounded-xl border border-veud-border/70 bg-black/15 p-4"
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="font-black text-veud-cream">
										{cursor.provider}/{cursor.kind} · {cursor.mode}
									</p>
									<span className="text-xs font-bold uppercase tracking-wider text-veud-mint">
										{cursor.leaseOwner ? 'Leased' : 'Available'}
									</span>
								</div>
								<dl className="mt-3 grid gap-2 text-xs text-veud-copy">
									<div>
										<dt className="inline font-bold">Last successful: </dt>
										<dd className="inline">
											{formatDate(cursor.lastSuccessfulAt)}
										</dd>
									</div>
									<div>
										<dt className="inline font-bold">Lease expires: </dt>
										<dd className="inline">
											{formatDate(cursor.leaseExpiresAt)}
										</dd>
									</div>
								</dl>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-veud-copy">
						No durable catalog cursors are recorded in this database.
					</p>
				)}
			</VeudPanel>
		</VeudPage>
	)
}
