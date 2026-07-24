import {
	data as json,
	Form,
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useActionData,
	useLoaderData,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	findModerationTarget,
	moderateAccount,
	moderateContent,
	setModeratorRole,
	updateReportWorkflow,
} from '#app/utils/moderation.server.ts'
import {
	isModerationTargetType,
	moderationReasonLabels,
	moderationTargetHref,
	moderationTargetLabels,
} from '#app/utils/moderation.ts'
import { requireUserWithPermission } from '#app/utils/permissions.server.ts'

const DashboardQuerySchema = z.object({
	view: z.enum(['queue', 'members', 'team', 'audit']).catch('queue'),
	status: z
		.enum(['active', 'open', 'in_review', 'resolved', 'dismissed', 'all'])
		.catch('active'),
	q: z.string().trim().max(100).catch(''),
})

const BaseActionSchema = z.object({
	intent: z.string(),
	reason: z.string().trim().min(3).max(1_000),
})

function displayTime(value: Date | string) {
	return new Date(value).toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	})
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	const actorId = await requireUserWithPermission(request, 'read:report:any', {
		url,
	})
	const filters = DashboardQuerySchema.parse(
		Object.fromEntries(new URL(request.url).searchParams),
	)
	const reportWhere =
		filters.status === 'all'
			? {}
			: filters.status === 'active'
				? { status: { in: ['open', 'in_review'] } }
				: { status: filters.status }

	const [
		reportCounts,
		reports,
		recentActions,
		staff,
		members,
		actor,
	] = await Promise.all([
		prisma.moderationReport.groupBy({
			by: ['status'],
			_count: { _all: true },
		}),
		prisma.moderationReport.findMany({
			where: reportWhere,
			orderBy: [
				{ priority: 'asc' },
				{ createdAt: 'asc' },
				{ id: 'asc' },
			],
			take: 60,
			select: {
				id: true,
				targetType: true,
				targetId: true,
				reasonCategory: true,
				details: true,
				status: true,
				priority: true,
				resolutionNote: true,
				createdAt: true,
				reporter: { select: { username: true } },
				subject: {
					select: {
						id: true,
						username: true,
						accountStatus: true,
						roles: { select: { name: true } },
					},
				},
				assignedTo: { select: { username: true } },
				appealOfAction: {
					select: {
						action: true,
						reason: true,
						createdAt: true,
					},
				},
			},
		}),
		prisma.moderationAction.findMany({
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: filters.view === 'audit' ? 100 : 12,
			select: {
				id: true,
				action: true,
				targetType: true,
				targetId: true,
				reason: true,
				details: true,
				previousStatus: true,
				nextStatus: true,
				createdAt: true,
				actor: { select: { username: true } },
				subject: { select: { username: true } },
			},
		}),
		prisma.user.findMany({
			where: {
				roles: {
					some: {
						name: { in: ['moderator', 'community-admin', 'admin'] },
					},
				},
			},
			orderBy: [{ username: 'asc' }],
			select: {
				id: true,
				username: true,
				name: true,
				accountStatus: true,
				lastActiveAt: true,
				roles: { select: { name: true } },
			},
		}),
		filters.q
			? prisma.user.findMany({
					where: {
						OR: [
							{ username: { contains: filters.q } },
							{ name: { contains: filters.q } },
						],
					},
					orderBy: [{ lastActiveAt: 'desc' }, { username: 'asc' }],
					take: 30,
					select: {
						id: true,
						username: true,
						name: true,
						accountStatus: true,
						suspensionEndsAt: true,
						roles: { select: { name: true } },
						_count: {
							select: {
								reviews: true,
								collectionComments: true,
								commentsAuthored: true,
							},
						},
					},
				})
			: [],
		prisma.user.findUniqueOrThrow({
			where: { id: actorId },
			select: {
				roles: {
					select: {
						name: true,
						permissions: {
							where: { action: 'assign', entity: 'role', access: 'any' },
							select: { id: true },
						},
					},
				},
			},
		}),
	])
	const targets = await prisma.$transaction(tx =>
		Promise.all(
			reports.map(report =>
				isModerationTargetType(report.targetType)
					? findModerationTarget(tx, report.targetType, report.targetId)
					: null,
			),
		),
	)
	const counts = Object.fromEntries(
		reportCounts.map(row => [row.status, row._count._all]),
	)
	return json(
		{
			filters,
			counts,
			reports: reports.map((report, index) => ({
				...report,
				target: targets[index],
			})),
			recentActions,
			staff,
			members,
			canAssignRoles: actor.roles.some(
				role =>
					role.name === 'admin' ||
					role.name === 'community-admin' ||
					role.permissions.length > 0,
			),
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}

export async function action({ request, url }: ActionFunctionArgs) {
	const formData = Object.fromEntries(await request.formData())
	const base = BaseActionSchema.safeParse(formData)
	if (!base.success) {
		return json(
			{ ok: false as const, error: 'A clear reason of at least 3 characters is required.' },
			{ status: 400 },
		)
	}
	const { intent, reason } = base.data
	if (
		intent === 'assign-self' ||
		intent === 'resolve' ||
		intent === 'dismiss' ||
		intent === 'reopen'
	) {
		const actorId = await requireUserWithPermission(
			request,
			'update:report:any',
			{ url },
		)
		const parsed = z
			.object({ reportId: z.string().min(1).max(100) })
			.safeParse(formData)
		if (!parsed.success) throw new Response('Invalid report action', { status: 400 })
		const result = await prisma.$transaction(tx =>
			updateReportWorkflow(tx, {
				actorId,
				reportId: parsed.data.reportId,
				intent,
				note: reason,
			}),
		)
		return json({ ok: true as const, message: `Report marked ${result.status}.` })
	}
	if (intent === 'hide-content' || intent === 'restore-content') {
		const actorId = await requireUserWithPermission(
			request,
			'moderate:content:any',
			{ url },
		)
		const parsed = z
			.object({
				targetType: z.enum([
					'review',
					'review_comment',
					'collection',
					'collection_comment',
					'profile_comment',
				]),
				targetId: z.string().min(1).max(100),
				reportId: z.string().max(100).optional(),
			})
			.safeParse(formData)
		if (!parsed.success) throw new Response('Invalid content action', { status: 400 })
		await prisma.$transaction(tx =>
			moderateContent(tx, {
				actorId,
				...parsed.data,
				reportId: parsed.data.reportId || undefined,
				nextStatus: intent === 'hide-content' ? 'hidden' : 'visible',
				reason,
			}),
		)
		return json({
			ok: true as const,
			message: intent === 'hide-content' ? 'Content hidden.' : 'Content restored.',
		})
	}
	if (intent === 'warn' || intent === 'suspend' || intent === 'restore') {
		const actorId = await requireUserWithPermission(
			request,
			'moderate:user:any',
			{ url },
		)
		const parsed = z
			.object({
				subjectId: z.string().min(1).max(100),
				reportId: z.string().max(100).optional(),
				suspensionDays: z.coerce.number().int().min(1).max(365).optional(),
			})
			.safeParse(formData)
		if (!parsed.success) throw new Response('Invalid account action', { status: 400 })
		await prisma.$transaction(tx =>
			moderateAccount(tx, {
				actorId,
				subjectId: parsed.data.subjectId,
				reportId: parsed.data.reportId || undefined,
				suspensionDays: parsed.data.suspensionDays,
				intent,
				reason,
			}),
		)
		return json({ ok: true as const, message: `Account action “${intent}” recorded.` })
	}
	if (intent === 'grant-moderator' || intent === 'revoke-moderator') {
		const actorId = await requireUserWithPermission(request, 'assign:role:any', {
			url,
		})
		const parsed = z
			.object({ username: z.string().trim().min(1).max(40) })
			.safeParse(formData)
		if (!parsed.success) throw new Response('Invalid role action', { status: 400 })
		const result = await prisma.$transaction(tx =>
			setModeratorRole(tx, {
				actorId,
				username: parsed.data.username,
				intent,
				reason,
			}),
		)
		return json({
			ok: true as const,
			message: `Moderator access ${result.assigned ? 'granted to' : 'revoked from'} @${result.username}.`,
		})
	}
	throw new Response('Unknown moderation action', { status: 400 })
}

function StatusBadge({ status }: { status: string }) {
	const tones: Record<string, string> = {
		open: 'border-red-300/60 bg-red-950/40 text-red-100',
		in_review: 'border-amber-300/60 bg-amber-950/40 text-amber-100',
		resolved: 'border-emerald-300/60 bg-emerald-950/40 text-emerald-100',
		dismissed: 'border-slate-300/40 bg-slate-950/30 text-slate-200',
		hidden: 'border-red-300/60 bg-red-950/40 text-red-100',
		visible: 'border-emerald-300/60 bg-emerald-950/40 text-emerald-100',
		suspended: 'border-red-300/60 bg-red-950/40 text-red-100',
		active: 'border-emerald-300/60 bg-emerald-950/40 text-emerald-100',
	}
	return (
		<span
			className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-wide ${tones[status] ?? tones.dismissed}`}
		>
			{status.replace('_', ' ')}
		</span>
	)
}

function ActionForm({
	intent,
	children,
	hidden,
	reasonPlaceholder = 'Document the policy basis…',
	confirm,
}: {
	intent: string
	children: React.ReactNode
	hidden: Record<string, string>
	reasonPlaceholder?: string
	confirm?: string
}) {
	const navigation = useNavigation()
	return (
		<Form
			method="post"
			className="grid gap-2 rounded-xl border border-veud-border/60 bg-black/10 p-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end"
			onSubmit={
				confirm
					? event => {
							if (!window.confirm(confirm)) event.preventDefault()
						}
					: undefined
			}
		>
			<input type="hidden" name="intent" value={intent} />
			{Object.entries(hidden).map(([name, value]) => (
				<input key={name} type="hidden" name={name} value={value} />
			))}
			<label className="grid gap-1 text-xs font-bold text-veud-mint">
				Reason
				<input
					name="reason"
					required
					minLength={3}
					maxLength={1000}
					placeholder={reasonPlaceholder}
					className="h-10 rounded-md border border-veud-border bg-veud-canvas px-3 text-sm text-veud-cream"
				/>
			</label>
			<Button
				type="submit"
				size="sm"
				variant={intent.includes('suspend') || intent.includes('hide') ? 'destructive' : 'outline'}
				disabled={navigation.state !== 'idle'}
			>
				{children}
			</Button>
		</Form>
	)
}

function dashboardHref(
	view: 'queue' | 'members' | 'team' | 'audit',
	status?: string,
) {
	const search = new URLSearchParams({ view })
	if (status) search.set('status', status)
	return `/moderation?${search}`
}

export default function ModerationDashboard() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const activeCount = (data.counts.open ?? 0) + (data.counts.in_review ?? 0)
	return (
		<VeudPage width="wide">
			<VeudPageHeader
				eyebrow="Trust & safety"
				title="Moderation"
				description={
					<p>
						Triage member reports, apply reversible enforcement, and keep
						every staff decision accountable.
					</p>
				}
				actions={
					<div className="rounded-xl border border-veud-border bg-veud-surface px-4 py-3 text-center">
						<p className="text-2xl font-black text-veud-yellow">{activeCount}</p>
						<p className="text-xs font-bold uppercase tracking-wide text-veud-mint">
							active reports
						</p>
					</div>
				}
			/>

			{actionData ? (
				<p
					role={actionData.ok ? 'status' : 'alert'}
					className={`rounded-xl border p-3 text-sm font-bold ${
						actionData.ok
							? 'border-veud-mint/50 bg-emerald-950/30 text-veud-mint'
							: 'border-destructive/60 bg-red-950/30 text-red-100'
					}`}
				>
					{actionData.ok ? actionData.message : actionData.error}
				</p>
			) : null}

			<nav
				aria-label="Moderation sections"
				className="flex gap-2 overflow-x-auto rounded-xl border border-veud-border bg-veud-surface p-2"
			>
				{[
					['queue', `Queue (${activeCount})`],
					['members', 'Member actions'],
					['team', 'Team access'],
					['audit', 'Audit log'],
				].map(([view, label]) => (
					<Button
						key={view}
						asChild
						variant={data.filters.view === view ? 'default' : 'ghost'}
						size="sm"
					>
						<Link to={dashboardHref(view as typeof data.filters.view)}>
							{label}
						</Link>
					</Button>
				))}
			</nav>

			{data.filters.view === 'queue' ? (
				<section className="space-y-4" aria-labelledby="moderation-queue-heading">
					<div className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h2 id="moderation-queue-heading" className="text-2xl font-black text-veud-yellow">
								Report queue
							</h2>
							<p className="text-sm text-veud-copy">
								Oldest high-priority reports appear first.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							{['active', 'open', 'in_review', 'resolved', 'dismissed', 'all'].map(
								status => (
									<Button
										key={status}
										asChild
										size="sm"
										variant={data.filters.status === status ? 'secondary' : 'ghost'}
									>
										<Link to={dashboardHref('queue', status)}>
											{status.replace('_', ' ')}
										</Link>
									</Button>
								),
							)}
						</div>
					</div>
					{data.reports.length ? (
						<div className="grid gap-4 xl:grid-cols-2">
							{data.reports.map(report => {
								const target = report.target
								const targetType = isModerationTargetType(report.targetType)
									? report.targetType
									: null
								const href =
									targetType && target
										? moderationTargetHref(targetType, target.id, target.context)
										: null
								return (
									<VeudPanel
										key={report.id}
										className="space-y-4"
										data-testid={`moderation-report-${report.id}`}
									>
										<header className="flex flex-wrap items-start justify-between gap-3">
											<div>
												<div className="flex flex-wrap items-center gap-2">
													<StatusBadge status={report.status} />
													{report.appealOfAction ? (
														<span className="rounded-full border border-violet-300/60 bg-violet-950/40 px-2.5 py-1 text-xs font-black uppercase text-violet-100">
															appeal
														</span>
													) : null}
													{report.priority === 'high' ? (
														<span className="rounded-full bg-red-500 px-2.5 py-1 text-xs font-black uppercase text-white">
															high priority
														</span>
													) : null}
												</div>
												<h3 className="mt-2 text-xl font-black text-veud-yellow">
													{target?.label ??
														(targetType
															? moderationTargetLabels[targetType]
															: report.targetType)}
												</h3>
												<p className="mt-1 text-xs text-veud-mint">
													Reported by @{report.reporter.username} ·{' '}
													{displayTime(report.createdAt)}
												</p>
											</div>
											{href ? (
												<Button asChild variant="ghost" size="sm">
													<Link to={href}>Open context</Link>
												</Button>
											) : null}
										</header>
										<div className="rounded-xl border border-veud-border/60 bg-veud-canvas p-3">
											<p className="text-xs font-black uppercase tracking-wide text-veud-mint">
												{moderationReasonLabels[
													report.reasonCategory as keyof typeof moderationReasonLabels
												] ?? report.reasonCategory}
											</p>
											{report.details ? (
												<p className="mt-2 whitespace-pre-wrap text-sm text-veud-copy">
													{report.details}
												</p>
											) : null}
											{report.appealOfAction ? (
												<p className="mt-3 rounded-lg border border-violet-300/30 bg-violet-950/20 p-3 text-xs text-violet-100">
													Original action:{' '}
													{report.appealOfAction.action.replaceAll('_', ' ')} ·{' '}
													{report.appealOfAction.reason}
												</p>
											) : null}
											{target ? (
												<blockquote className="mt-3 border-l-2 border-veud-border pl-3 text-sm italic text-veud-cream">
													{target.excerpt}
												</blockquote>
											) : (
												<p className="mt-3 text-sm text-red-200">
													The reported target is no longer available.
												</p>
											)}
										</div>
										<p className="text-xs text-veud-mint">
											Assigned to{' '}
											{report.assignedTo
												? `@${report.assignedTo.username}`
												: 'nobody'}
										</p>
										{report.status === 'open' ? (
											<ActionForm
												intent="assign-self"
												hidden={{ reportId: report.id }}
												reasonPlaceholder="Why are you taking this report?"
											>
												Assign to me
											</ActionForm>
										) : null}
										{target &&
										targetType &&
										targetType !== 'account' &&
										report.status !== 'dismissed' ? (
											<ActionForm
												intent={
													target.status === 'hidden'
														? 'restore-content'
														: 'hide-content'
												}
												hidden={{
													reportId: report.id,
													targetType,
													targetId: target.id,
												}}
												confirm={
													target.status === 'hidden'
														? undefined
														: 'Hide this content and notify its author?'
												}
											>
												{target.status === 'hidden'
													? 'Restore content'
													: 'Hide content'}
											</ActionForm>
										) : null}
										{report.subject ? (
											<div className="space-y-2">
												<ActionForm
													intent="warn"
													hidden={{
														reportId: report.id,
														subjectId: report.subject.id,
													}}
													reasonPlaceholder="Warning shown to the member…"
												>
													Warn member
												</ActionForm>
												{report.subject.accountStatus === 'suspended' ? (
													<ActionForm
														intent="restore"
														hidden={{
															reportId: report.id,
															subjectId: report.subject.id,
														}}
													>
														Restore account
													</ActionForm>
												) : (
													<Form
														method="post"
														className="grid gap-2 rounded-xl border border-red-400/30 bg-red-950/20 p-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end"
														onSubmit={event => {
															if (!window.confirm('Suspend this account and revoke its active sessions?')) {
																event.preventDefault()
															}
														}}
													>
														<input type="hidden" name="intent" value="suspend" />
														<input type="hidden" name="reportId" value={report.id} />
														<input type="hidden" name="subjectId" value={report.subject.id} />
														<label className="grid gap-1 text-xs font-bold text-veud-mint">
															Reason
															<input
																name="reason"
																required
																minLength={3}
																maxLength={1000}
																className="h-10 rounded-md border border-veud-border bg-veud-canvas px-3 text-sm"
															/>
														</label>
														<label className="grid gap-1 text-xs font-bold text-veud-mint">
															Days
															<input
																name="suspensionDays"
																type="number"
																min={1}
																max={365}
																defaultValue={7}
																required
																className="h-10 rounded-md border border-veud-border bg-veud-canvas px-3 text-sm"
															/>
														</label>
														<Button type="submit" variant="destructive" size="sm">
															Suspend
														</Button>
													</Form>
												)}
											</div>
										) : null}
										<div className="grid gap-2 sm:grid-cols-2">
											{report.status !== 'resolved' ? (
												<ActionForm
													intent="resolve"
													hidden={{ reportId: report.id }}
													reasonPlaceholder="Resolution summary…"
												>
													Resolve
												</ActionForm>
											) : null}
											{report.status !== 'dismissed' ? (
												<ActionForm
													intent="dismiss"
													hidden={{ reportId: report.id }}
													reasonPlaceholder="Why is no action needed?"
												>
													Dismiss
												</ActionForm>
											) : null}
											{report.status === 'resolved' ||
											report.status === 'dismissed' ? (
												<ActionForm
													intent="reopen"
													hidden={{ reportId: report.id }}
													reasonPlaceholder="Why should this be reviewed again?"
												>
													Reopen
												</ActionForm>
											) : null}
										</div>
									</VeudPanel>
								)
							})}
						</div>
					) : (
						<VeudEmptyState title="Queue clear">
							<p>No reports match this view.</p>
						</VeudEmptyState>
					)}
				</section>
			) : null}

			{data.filters.view === 'members' || data.filters.view === 'team' ? (
				<section className="space-y-5">
					<div>
						<h2 className="text-2xl font-black text-veud-yellow">
							{data.filters.view === 'team' ? 'Moderation team' : 'Member actions'}
						</h2>
						<p className="text-sm text-veud-copy">
							Search exact or partial usernames and display names.
						</p>
					</div>
					<Form method="get" className="flex flex-col gap-2 sm:flex-row">
						<input type="hidden" name="view" value={data.filters.view} />
						<input
							name="q"
							defaultValue={data.filters.q}
							maxLength={100}
							placeholder="Search members"
							className="h-11 min-w-0 flex-1 rounded-md border border-veud-border bg-veud-canvas px-3"
						/>
						<Button type="submit">Search</Button>
					</Form>
					{data.filters.view === 'team' ? (
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{data.staff.map(member => (
								<VeudPanel key={member.id} className="space-y-2">
									<h3 className="font-black text-veud-yellow">
										@{member.username}
									</h3>
									<p className="text-sm text-veud-mint">@{member.username}</p>
									<div className="flex flex-wrap gap-2">
										{member.roles.map(role => (
											<StatusBadge key={role.name} status={role.name} />
										))}
									</div>
									<p className="text-xs text-veud-copy">
										{member.lastActiveAt
											? `Last active ${displayTime(member.lastActiveAt)}`
											: 'No recorded activity'}
									</p>
								</VeudPanel>
							))}
						</div>
					) : null}
					{data.filters.q ? (
						<div className="grid gap-4 lg:grid-cols-2">
							{data.members.map(member => {
								const isModerator = member.roles.some(
									role => role.name === 'moderator',
								)
								return (
									<VeudPanel key={member.id} className="space-y-4">
										<header className="flex items-start justify-between gap-3">
											<div>
												<h3 className="text-lg font-black text-veud-yellow">
													<Link to={`/users/${member.username}`}>
														{member.username}
													</Link>
												</h3>
												<p className="text-sm text-veud-mint">
													@{member.username}
												</p>
											</div>
											<StatusBadge status={member.accountStatus} />
										</header>
										<p className="text-xs text-veud-copy">
											{member._count.reviews} reviews ·{' '}
											{member._count.collectionComments +
												member._count.commentsAuthored}{' '}
											comments
										</p>
										{data.canAssignRoles ? (
											<ActionForm
												intent={
													isModerator
														? 'revoke-moderator'
														: 'grant-moderator'
												}
												hidden={{ username: member.username }}
												confirm={
													isModerator
														? `Revoke moderator access from @${member.username}?`
														: undefined
												}
											>
												{isModerator
													? 'Revoke moderator'
													: 'Grant moderator'}
											</ActionForm>
										) : null}
										{member.accountStatus === 'suspended' ? (
											<ActionForm
												intent="restore"
												hidden={{ subjectId: member.id }}
											>
												Restore account
											</ActionForm>
										) : (
											<ActionForm
												intent="warn"
												hidden={{ subjectId: member.id }}
												reasonPlaceholder="Warning shown to the member…"
											>
												Warn member
											</ActionForm>
										)}
									</VeudPanel>
								)
							})}
						</div>
					) : (
						<VeudEmptyState title="Search for a member">
							<p>Use a username or display name to review account standing.</p>
						</VeudEmptyState>
					)}
				</section>
			) : null}

			{data.filters.view === 'audit' ? (
				<section className="space-y-4" aria-labelledby="moderation-audit-heading">
					<div>
						<h2 id="moderation-audit-heading" className="text-2xl font-black text-veud-yellow">
							Immutable action log
						</h2>
						<p className="text-sm text-veud-copy">
							The latest 100 staff decisions, newest first.
						</p>
					</div>
					<div className="overflow-x-auto rounded-xl border border-veud-border bg-veud-surface">
						<table className="min-w-full text-left text-sm">
							<thead className="bg-black/20 text-xs uppercase tracking-wide text-veud-mint">
								<tr>
									<th className="px-4 py-3">Time</th>
									<th className="px-4 py-3">Moderator</th>
									<th className="px-4 py-3">Action</th>
									<th className="px-4 py-3">Subject</th>
									<th className="px-4 py-3">Reason</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-veud-border/50">
								{data.recentActions.map(event => (
									<tr key={event.id}>
										<td className="whitespace-nowrap px-4 py-3 text-xs text-veud-copy">
											{displayTime(event.createdAt)}
										</td>
										<td className="px-4 py-3 font-bold text-veud-yellow">
											{event.actor ? `@${event.actor.username}` : 'Deleted staff'}
										</td>
										<td className="px-4 py-3">
											{event.action.replaceAll('_', ' ')}
											{event.previousStatus || event.nextStatus ? (
												<span className="block text-xs text-veud-mint">
													{event.previousStatus ?? '—'} →{' '}
													{event.nextStatus ?? '—'}
												</span>
											) : null}
										</td>
										<td className="px-4 py-3 text-veud-copy">
											{event.subject
												? `@${event.subject.username}`
												: `${event.targetType}:${event.targetId}`}
										</td>
										<td className="max-w-md px-4 py-3 text-veud-copy">
											{event.reason}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : null}
		</VeudPage>
	)
}

export const meta: MetaFunction = () => [
	{ title: 'Moderation · Veud' },
	{
		name: 'description',
		content: 'Private trust and safety operations for Veud moderators.',
	},
]

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
