import {
	data as json,
	Form,
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
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { isAiCapabilityConfigured } from '#app/utils/ai-gateway.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	applyTrackingCommandPreview,
	createTrackingCommandPreview,
	getTrackingCommandPreviews,
	undoTrackingCommandPreview,
} from '#app/utils/tracking-command.server.ts'

const ActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('preview'),
		command: z.string().trim().min(3).max(800),
	}),
	z.object({
		intent: z.literal('apply'),
		previewId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('undo'),
		previewId: z.string().min(1).max(100),
	}),
])

export const meta: MetaFunction = () => [
	{ title: 'Tracking assistant | Veud' },
	{
		name: 'description',
		content:
			'Preview and confirm natural-language changes to your Veud tracking library.',
	},
]

export async function loader({ request, url }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request, { url })
	return json({
		previews: await getTrackingCommandPreviews(prisma, ownerId),
		enabled: isAiCapabilityConfigured('tracking-command'),
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const parsed = ActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return json(
			{ ok: false as const, error: 'Invalid tracking assistant request.' },
			{ status: 400 },
		)
	}
	try {
		if (parsed.data.intent === 'preview') {
			const preview = await createTrackingCommandPreview(prisma, {
				ownerId,
				requestText: parsed.data.command,
				rateLimitKey: `viewer:${ownerId}`,
			})
			return json({ ok: true as const, previewId: preview.id })
		}
		if (parsed.data.intent === 'apply') {
			const result = await applyTrackingCommandPreview(prisma, {
				ownerId,
				previewId: parsed.data.previewId,
			})
			return json({ ok: true as const, summary: result.summary })
		}
		const result = await undoTrackingCommandPreview(prisma, {
			ownerId,
			previewId: parsed.data.previewId,
		})
		return json({
			ok: true as const,
			summary: `Undid: ${result.summary}`,
		})
	} catch (error) {
		if (error instanceof Response) {
			return json(
				{ ok: false as const, error: await error.text() },
				{ status: error.status },
			)
		}
		return json(
			{
				ok: false as const,
				error:
					error instanceof Error
						? error.message
						: 'The assistant could not prepare this change.',
			},
			{ status: 503 },
		)
	}
}

export default function AssistantRoute() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'

	return (
		<VeudPage>
			<VeudPageHeader
				eyebrow="Private command palette"
				title="Tracking assistant"
				description="Describe a change, review it, then apply."
			/>

			<VeudPanel>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="preview" />
					<div className="block space-y-2">
						<Label htmlFor="tracking-assistant-command">
							What should Veud change?
						</Label>
						<Textarea
							id="tracking-assistant-command"
							name="command"
							required
							minLength={3}
							maxLength={800}
							rows={4}
							placeholder="Move Frieren to Watching, mark episode 12 complete, and score it 9."
						/>
					</div>
					<div className="rounded-xl border border-veud-border/70 bg-veud-canvas/70 p-3 text-sm text-veud-copy">
						{data.enabled
							? 'AI-assisted · nothing changes until you approve the preview.'
							: 'Assistant unavailable.'}
					</div>
					<Button type="submit" disabled={busy || !data.enabled}>
						{busy && navigation.formData?.get('intent') === 'preview'
							? 'Building preview…'
							: data.enabled
								? 'Preview changes'
								: 'Assistant disabled'}
					</Button>
				</Form>
				{actionData && !actionData.ok ? (
					<p
						className="mt-4 rounded-xl border border-red-400/45 bg-red-950/30 p-3 text-red-100"
						role="alert"
					>
						{actionData.error}
					</p>
				) : actionData && actionData.ok && 'summary' in actionData ? (
					<p
						className="mt-4 rounded-xl border border-veud-mint/45 bg-emerald-950/25 p-3 text-veud-mint"
						role="status"
					>
						Applied: {actionData.summary}
					</p>
				) : null}
			</VeudPanel>

			<section className="space-y-4" aria-labelledby="assistant-previews">
				<h2
					id="assistant-previews"
					className="text-2xl font-black text-veud-cream"
				>
					Recent previews
				</h2>
				{data.previews.length ? (
					<div className="grid gap-4">
						{data.previews.map(preview => (
							<VeudPanel key={preview.id}>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p className="text-sm text-veud-copy">
											“{preview.requestText}”
										</p>
										<h3 className="mt-1 text-lg font-black text-veud-cream">
											{preview.plan.summary}
										</h3>
									</div>
									<span className="rounded-full border border-veud-border px-3 py-1 text-xs font-black uppercase text-veud-mint">
										{preview.status}
									</span>
								</div>
								<ul className="mt-4 grid gap-2">
									{preview.plan.operations.map((operation, index) => (
										<li
											key={`${operation.mediaId}:${index}`}
											className="rounded-xl border border-veud-border/60 bg-veud-canvas/70 p-3 text-sm"
										>
											<strong className="text-veud-cream">
												{operation.mediaTitle}
											</strong>
											<span className="ml-2 text-veud-copy">
												{[
													operation.watchlistLabel
														? `move to ${operation.watchlistLabel}`
														: null,
													operation.score !== null
														? `score ${operation.score || 'blank'}`
														: null,
													operation.progressCurrent !== null
														? `${operation.progressUnit} ${operation.progressCurrent}`
														: null,
													operation.favorite !== null
														? operation.favorite
															? 'add favorite'
															: 'remove favorite'
														: null,
													operation.collectionLabel
														? `add to ${operation.collectionLabel}`
														: null,
												]
													.filter(Boolean)
													.join(' · ')}
											</span>
											{operation.changes.length ? (
												<dl className="mt-3 grid gap-2 sm:grid-cols-2">
													{operation.changes.map(change => (
														<div
															key={`${change.field}:${change.before}:${change.after}`}
															className="rounded-lg border border-veud-border/50 bg-black/10 p-2"
														>
															<dt className="text-xs font-black uppercase text-veud-mint">
																{change.field}
															</dt>
															<dd className="mt-1 text-xs text-veud-copy">
																{change.before} →{' '}
																<strong className="text-veud-cream">
																	{change.after}
																</strong>
															</dd>
														</div>
													))}
												</dl>
											) : null}
										</li>
									))}
								</ul>
								<p className="mt-3 text-xs font-bold text-veud-copy">
									{preview.plan.operations.length}{' '}
									{preview.plan.operations.length === 1 ? 'title' : 'titles'}{' '}
									affected
								</p>
								{preview.status === 'pending' &&
								new Date(preview.expiresAt) > new Date() ? (
									<Form method="post" className="mt-4">
										<input type="hidden" name="intent" value="apply" />
										<input type="hidden" name="previewId" value={preview.id} />
										<Button type="submit" disabled={busy}>
											Confirm and apply
										</Button>
									</Form>
								) : null}
								{preview.canUndo ? (
									<Form method="post" className="mt-4">
										<input type="hidden" name="intent" value="undo" />
										<input type="hidden" name="previewId" value={preview.id} />
										<Button type="submit" variant="outline" disabled={busy}>
											Undo this command
										</Button>
									</Form>
								) : null}
							</VeudPanel>
						))}
					</div>
				) : (
					<VeudEmptyState title="No commands yet">
						Your confirmed-before-write previews will appear here.
					</VeudEmptyState>
				)}
			</section>
		</VeudPage>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
