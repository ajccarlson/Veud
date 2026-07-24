import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	Form,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	Link,
	redirect,
	useActionData,
	useLoaderData,
} from 'react-router'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { AiGatewayError } from '#app/utils/ai-gateway.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { assistLibraryImportReconciliation } from '#app/utils/library-import-ai.server.ts'
import {
	applyLibraryImportBatch,
	LibraryImportError,
	libraryImportResolutions,
	parseStoredLibraryImportItem,
	rollbackLibraryImportBatch,
} from '#app/utils/library-import-commit.server.ts'
import { reconcileLibraryImport } from '#app/utils/library-import-reconciliation.server.ts'
import {
	libraryImportProviders,
	parseLibraryImport,
} from '#app/utils/library-import.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { type BreadcrumbHandle } from './profile.tsx'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_IMPORT_ITEMS = 2_000
const ProviderSchema = z.enum(libraryImportProviders)
const ChoiceSchema = z.enum(libraryImportResolutions)
const BulkConflictChoiceSchema = z.enum(['merge', 'replace', 'skip'])

function entriesLabel(count: number) {
	return `${count.toLocaleString()} ${count === 1 ? 'entry' : 'entries'}`
}

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: 'Import library',
	getSitemapEntries: () => null,
}

function candidates(value: string) {
	try {
		const parsed: unknown = JSON.parse(value)
		return Array.isArray(parsed)
			? parsed.flatMap(candidate =>
					candidate &&
					typeof candidate === 'object' &&
					'mediaId' in candidate &&
					'title' in candidate &&
					typeof candidate.mediaId === 'string' &&
					typeof candidate.title === 'string'
						? [
								{
									mediaId: candidate.mediaId,
									title: candidate.title,
									thumbnail:
										'thumbnail' in candidate &&
										typeof candidate.thumbnail === 'string'
											? candidate.thumbnail
											: null,
								},
							]
						: [],
				)
			: []
	} catch {
		return []
	}
}

function aiHypotheses(value: string | null) {
	if (!value) return []
	try {
		return z
			.array(
				z.object({
					title: z.string(),
					uncertainty: z.enum(['low', 'medium', 'high']),
				}),
			)
			.parse(JSON.parse(value) as unknown)
	} catch {
		return []
	}
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request, { url })
	const searchParams = new URL(request.url).searchParams
	const batchId = searchParams.get('batch')
	const requestedPage = Number(searchParams.get('page') ?? 1)
	const page =
		Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
	const recent = await prisma.libraryImportBatch.findMany({
		where: { ownerId },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		take: 10,
		select: {
			id: true,
			fileName: true,
			provider: true,
			status: true,
			itemCount: true,
			matchedCount: true,
			ambiguousCount: true,
			unmatchedCount: true,
			conflictCount: true,
			appliedAt: true,
			rolledBackAt: true,
			createdAt: true,
		},
	})
	const selectedId = batchId ?? recent[0]?.id
	const selected = selectedId
		? await prisma.libraryImportBatch.findFirst({
				where: { id: selectedId, ownerId },
				include: {
					items: {
						orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
						skip: (page - 1) * 100,
						take: 100,
						include: {
							media: {
								select: { id: true, title: true, thumbnail: true },
							},
						},
					},
				},
			})
		: null
	const parsedCandidates = selected
		? new Map(
				selected.items.map(item => [item.id, candidates(item.candidates)]),
			)
		: new Map<string, ReturnType<typeof candidates>>()
	const candidateMediaIds = selected
		? [
				...new Set(
					selected.items.flatMap(item => [
						...(item.mediaId ? [item.mediaId] : []),
						...(parsedCandidates.get(item.id) ?? []).map(
							candidate => candidate.mediaId,
						),
					]),
				),
			]
		: []
	const trackedCandidateIds = candidateMediaIds.length
		? new Set(
				(
					await prisma.trackingState.findMany({
						where: { ownerId, mediaId: { in: candidateMediaIds } },
						select: { mediaId: true },
					})
				).map(state => state.mediaId),
			)
		: new Set<string>()
	return json({
		recent,
		selected: selected
			? {
					...selected,
					items: selected.items.map(item => ({
						id: item.id,
						source: parseStoredLibraryImportItem(item.payload),
						matchState: item.matchState,
						matchMethod: item.matchMethod,
						hasConflict: item.mediaId
							? trackedCandidateIds.has(item.mediaId)
							: item.hasConflict,
						candidates: (parsedCandidates.get(item.id) ?? []).map(
							candidate => ({
								...candidate,
								hasConflict: trackedCandidateIds.has(candidate.mediaId),
							}),
						),
						resolution: item.resolution,
						mediaId: item.mediaId,
						mediaTitle: item.media?.title ?? null,
						mediaThumbnail: item.media?.thumbnail ?? null,
						appliedAt: item.appliedAt,
						aiHypotheses: aiHypotheses(item.aiHypotheses),
						aiPromptVersion: item.aiPromptVersion,
					})),
					page,
					pageCount: Math.max(1, Math.ceil(selected.itemCount / 100)),
				}
			: null,
	})
}

async function previewImport(ownerId: string, request: Request) {
	const contentLength = Number(request.headers.get('content-length') ?? 0)
	if (contentLength > MAX_IMPORT_BYTES + 100_000) {
		throw new LibraryImportError(
			'The import file must be 5 MB or smaller.',
			413,
		)
	}
	const formData = await request.formData()
	const provider = ProviderSchema.safeParse(formData.get('provider'))
	const upload = formData.get('library')
	if (!provider.success || !(upload instanceof File) || !upload.size) {
		throw new LibraryImportError('Choose a provider and export file.')
	}
	if (upload.size > MAX_IMPORT_BYTES) {
		throw new LibraryImportError(
			'The import file must be 5 MB or smaller.',
			413,
		)
	}
	let items
	try {
		items = parseLibraryImport(provider.data, await upload.text())
	} catch {
		throw new LibraryImportError(
			'The export could not be parsed. Confirm the provider and use its original XML, JSON, or CSV file.',
		)
	}
	if (!items.length) {
		throw new LibraryImportError(
			'No supported library entries were found in this export.',
		)
	}
	if (items.length > MAX_IMPORT_ITEMS) {
		throw new LibraryImportError(
			`This preview contains ${items.length.toLocaleString()} entries. Split it into batches of 2,000 or fewer.`,
		)
	}
	const resolutions = await reconcileLibraryImport(prisma, ownerId, items)
	const summary = resolutions.reduce(
		(counts, item) => {
			counts[item.match.state] += 1
			if (item.existing) counts.conflicts += 1
			return counts
		},
		{ matched: 0, ambiguous: 0, unmatched: 0, conflicts: 0 },
	)
	const batch = await prisma.libraryImportBatch.create({
		data: {
			ownerId,
			provider: provider.data,
			fileName: upload.name.slice(0, 160),
			itemCount: resolutions.length,
			matchedCount: summary.matched,
			ambiguousCount: summary.ambiguous,
			unmatchedCount: summary.unmatched,
			conflictCount: summary.conflicts,
			items: {
				create: resolutions.map(item => ({
					sourceKey: item.sourceKey,
					payload: JSON.stringify({
						sourceKey: item.sourceKey,
						provider: item.provider,
						mediaKind: item.mediaKind,
						title: item.title,
						externalId: item.externalId,
						externalProvider: item.externalProvider,
						status: item.status,
						score: item.score,
						progress: item.progress,
						repeatCount: item.repeatCount,
						startedAt: item.startedAt,
						completedAt: item.completedAt,
					}),
					matchState: item.match.state,
					matchMethod:
						item.match.state === 'matched' ? item.match.method : null,
					hasConflict: Boolean(item.existing),
					candidates: JSON.stringify(
						item.match.state === 'ambiguous' ? item.match.candidates : [],
					),
					mediaId: item.match.state === 'matched' ? item.match.mediaId : null,
					resolution:
						item.match.state === 'matched' && !item.existing ? 'add' : 'skip',
				})),
			},
		},
		select: { id: true },
	})
	return json({
		ok: true as const,
		message: `Built a private preview for ${entriesLabel(resolutions.length)}.`,
		batchId: batch.id,
	})
}

async function refreshConflictCount(ownerId: string, batchId: string) {
	const conflictCount = await prisma.libraryImportItem.count({
		where: { batchId, hasConflict: true },
	})
	await prisma.libraryImportBatch.updateMany({
		where: { id: batchId, ownerId, status: 'previewed' },
		data: { conflictCount },
	})
}

async function updateChoice(ownerId: string, formData: FormData) {
	const input = z
		.object({
			batchId: z.string().min(1).max(100),
			itemId: z.string().min(1).max(100),
			resolution: ChoiceSchema,
			mediaId: z.string().max(100).optional(),
			page: z.coerce.number().int().min(1).max(20).default(1),
		})
		.safeParse(Object.fromEntries(formData))
	if (!input.success)
		throw new LibraryImportError('The import choice is invalid.')
	const item = await prisma.libraryImportItem.findFirst({
		where: {
			id: input.data.itemId,
			batchId: input.data.batchId,
			batch: { ownerId, status: 'previewed' },
		},
		select: {
			id: true,
			mediaId: true,
			matchState: true,
			candidates: true,
		},
	})
	if (!item) throw new LibraryImportError('Import row not found.', 404)
	const selectedMediaId = input.data.mediaId || item.mediaId
	const permitted = new Set([
		...(item.mediaId ? [item.mediaId] : []),
		...candidates(item.candidates).map(candidate => candidate.mediaId),
	])
	if (
		input.data.resolution !== 'skip' &&
		(!selectedMediaId || !permitted.has(selectedMediaId))
	) {
		throw new LibraryImportError('Choose one of the matched catalog items.')
	}
	const hasConflict = selectedMediaId
		? Boolean(
				await prisma.trackingState.findUnique({
					where: {
						ownerId_mediaId: { ownerId, mediaId: selectedMediaId },
					},
					select: { id: true },
				}),
			)
		: false
	if (input.data.resolution === 'add' && hasConflict) {
		await prisma.libraryImportItem.updateMany({
			where: {
				id: item.id,
				batch: { ownerId, status: 'previewed' },
			},
			data: {
				mediaId: selectedMediaId,
				hasConflict: true,
				resolution: 'skip',
			},
		})
		await refreshConflictCount(ownerId, input.data.batchId)
		throw new LibraryImportError(
			'That catalog item is already tracked. Choose merge, replace, or skip.',
			409,
		)
	}
	const updated = await prisma.libraryImportItem.updateMany({
		where: {
			id: item.id,
			batch: { ownerId, status: 'previewed' },
		},
		data: {
			resolution: input.data.resolution,
			hasConflict,
			mediaId:
				input.data.resolution === 'skip' ? selectedMediaId : selectedMediaId!,
		},
	})
	if (updated.count !== 1) {
		throw new LibraryImportError(
			'This import preview is no longer editable.',
			409,
		)
	}
	await refreshConflictCount(ownerId, input.data.batchId)
	return redirect(
		`/settings/profile/import?batch=${input.data.batchId}&page=${input.data.page}`,
	)
}

async function updateConflictChoices(ownerId: string, formData: FormData) {
	const input = z
		.object({
			batchId: z.string().min(1).max(100),
			resolution: BulkConflictChoiceSchema,
			page: z.coerce.number().int().min(1).max(20).default(1),
		})
		.safeParse(Object.fromEntries(formData))
	if (!input.success)
		throw new LibraryImportError('The bulk conflict choice is invalid.')
	const updated = await prisma.libraryImportItem.updateMany({
		where: {
			batchId: input.data.batchId,
			batch: { ownerId, status: 'previewed' },
			hasConflict: true,
			mediaId: { not: null },
		},
		data: { resolution: input.data.resolution },
	})
	if (!updated.count) {
		const batch = await prisma.libraryImportBatch.findFirst({
			where: {
				id: input.data.batchId,
				ownerId,
				status: 'previewed',
			},
			select: { id: true },
		})
		if (!batch) {
			throw new LibraryImportError(
				'This import preview is no longer editable.',
				409,
			)
		}
	}
	return redirect(
		`/settings/profile/import?batch=${input.data.batchId}&page=${input.data.page}`,
	)
}

export async function action({ request, url }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request, { url })
	try {
		if (request.headers.get('content-type')?.includes('multipart/form-data')) {
			return await previewImport(ownerId, request)
		}
		const formData = await request.formData()
		const intent = String(formData.get('intent') ?? 'preview')
		if (intent === 'update-choice') {
			return await updateChoice(ownerId, formData)
		}
		if (intent === 'bulk-conflicts') {
			return await updateConflictChoices(ownerId, formData)
		}
		const batchId = z
			.string()
			.min(1)
			.max(100)
			.safeParse(formData.get('batchId'))
		if (!batchId.success)
			throw new LibraryImportError('Import batch not found.')
		if (intent === 'ai-reconcile') {
			const result = await assistLibraryImportReconciliation(prisma, {
				ownerId,
				batchId: batchId.data,
				rateLimitKey: `viewer:${ownerId}`,
			})
			return json({
				ok: true as const,
				message: `Prepared local candidates for ${entriesLabel(result.assistedCount)}. Review every suggestion before importing.`,
				batchId: batchId.data,
			})
		}
		if (intent === 'apply') {
			const result = await prisma.$transaction(
				tx => applyLibraryImportBatch(tx, { ownerId, batchId: batchId.data }),
				{ maxWait: 5_000, timeout: 120_000 },
			)
			return json({
				ok: true as const,
				message: `Imported ${entriesLabel(result.appliedCount)} atomically.`,
				batchId: batchId.data,
			})
		}
		if (intent === 'rollback') {
			const result = await prisma.$transaction(
				tx =>
					rollbackLibraryImportBatch(tx, {
						ownerId,
						batchId: batchId.data,
					}),
				{ maxWait: 5_000, timeout: 120_000 },
			)
			return json({
				ok: true as const,
				message: `Rolled back ${entriesLabel(result.rolledBackCount)}.`,
				batchId: batchId.data,
			})
		}
		if (intent === 'delete-preview') {
			const deleted = await prisma.libraryImportBatch.deleteMany({
				where: { id: batchId.data, ownerId, status: 'previewed' },
			})
			if (deleted.count !== 1) {
				throw new LibraryImportError(
					'This import preview is no longer editable.',
					409,
				)
			}
			return json({
				ok: true as const,
				message: 'Deleted the private import preview.',
				batchId: null,
			})
		}
		throw new LibraryImportError('Unsupported import action.')
	} catch (error) {
		if (error instanceof LibraryImportError) {
			return json(
				{ ok: false as const, error: error.message },
				{ status: error.status },
			)
		}
		if (error instanceof Response) {
			return json(
				{
					ok: false as const,
					error: await error.text(),
				},
				{ status: error.status },
			)
		}
		if (error instanceof AiGatewayError) {
			return json(
				{
					ok: false as const,
					error:
						error.reason === 'rate-limited'
							? 'AI title assistance has reached its temporary limit. Deterministic import matching remains available.'
							: 'AI title assistance is temporarily unavailable. Your preview is unchanged.',
				},
				{ status: error.reason === 'rate-limited' ? 429 : 503 },
			)
		}
		throw error
	}
}

const providerLabels = {
	myanimelist: 'MyAnimeList XML',
	anilist: 'AniList JSON',
	trakt: 'Trakt JSON',
	letterboxd: 'Letterboxd CSV',
} as const

export default function ProfileImportRoute() {
	const { recent, selected } = useLoaderData<typeof loader>()
	const result = useActionData<typeof action>()
	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-2xl font-black text-veud-cream">
					Import another library
				</h2>
				<p className="mt-2 text-sm leading-6 text-veud-copy">
					Preview matches and choose how conflicts are handled before Veud
					changes anything. Provider files stay in this request and are never
					sent to an AI service.
				</p>
			</div>
			<Form
				method="post"
				encType="multipart/form-data"
				className="grid gap-4 rounded-2xl border border-veud-border bg-black/10 p-5"
			>
				<input type="hidden" name="intent" value="preview" />
				<label className="grid gap-2 text-sm font-black text-veud-copy">
					Source
					<select
						name="provider"
						required
						className="min-h-11 rounded-xl border border-veud-border bg-veud-canvas px-3 text-veud-cream"
					>
						{libraryImportProviders.map(provider => (
							<option key={provider} value={provider}>
								{providerLabels[provider]}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-2 text-sm font-black text-veud-copy">
					Export file
					<input
						type="file"
						name="library"
						required
						accept=".xml,.json,.csv,text/xml,application/json,text/csv"
						className="min-h-11 rounded-xl border border-veud-border bg-black/20 p-2 text-veud-copy file:mr-3 file:rounded-lg file:border-0 file:bg-veud-mint file:px-3 file:py-2 file:font-black file:text-veud-canvas"
					/>
				</label>
				<Button type="submit">Build conflict preview</Button>
				<p className="text-xs text-veud-copy">
					Maximum 5 MB and 2,000 entries per preview.
				</p>
			</Form>
			{result ? (
				<p
					role={result.ok ? 'status' : 'alert'}
					className={
						result.ok
							? 'rounded-xl border border-veud-mint/40 bg-veud-mint/10 p-4 text-sm text-veud-cream'
							: 'rounded-xl border border-red-300/40 bg-red-950/30 p-4 text-sm text-red-100'
					}
				>
					{result.ok ? result.message : result.error}
				</p>
			) : null}
			{recent.length ? (
				<nav aria-label="Import history" className="flex flex-wrap gap-2">
					{recent.map(batch => (
						<Link
							key={batch.id}
							to={`/settings/profile/import?batch=${batch.id}`}
							className={`rounded-full border px-3 py-2 text-xs font-black ${
								selected?.id === batch.id
									? 'border-veud-mint bg-veud-mint/15 text-veud-cream'
									: 'border-veud-border text-veud-copy'
							}`}
						>
							{batch.fileName} · {batch.status.replace('_', ' ')}
						</Link>
					))}
				</nav>
			) : null}
			{selected ? (
				<section aria-labelledby="import-preview-heading">
					<div className="flex flex-wrap items-end justify-between gap-4">
						<div>
							<p className="text-xs font-black uppercase tracking-widest text-veud-mint">
								{selected.status.replace('_', ' ')}
							</p>
							<h2
								id="import-preview-heading"
								className="text-xl font-black text-veud-yellow"
							>
								{selected.fileName}
							</h2>
						</div>
						<div className="flex flex-wrap gap-2">
							{selected.status === 'previewed' ? (
								<>
									{selected.ambiguousCount + selected.unmatchedCount > 0 ? (
										<div className="max-w-sm">
											<Form method="post">
												<input
													type="hidden"
													name="intent"
													value="ai-reconcile"
												/>
												<input
													type="hidden"
													name="batchId"
													value={selected.id}
												/>
												<Button type="submit" variant="outline">
													Assist up to{' '}
													{Math.min(
														25,
														selected.ambiguousCount + selected.unmatchedCount,
													)}{' '}
													unresolved titles
												</Button>
											</Form>
											<p className="mt-1 text-xs leading-5 text-veud-copy">
												Opt-in: sends only each unresolved imported title, media
												kind, and provider label to OpenAI. Catalog candidates
												and your tracking history stay local.
											</p>
										</div>
									) : null}
									{selected.conflictCount ? (
										<Form
											method="post"
											className="flex flex-wrap items-end gap-2"
										>
											<input
												type="hidden"
												name="intent"
												value="bulk-conflicts"
											/>
											<input type="hidden" name="batchId" value={selected.id} />
											<input type="hidden" name="page" value={selected.page} />
											<label className="grid gap-1 text-xs font-black text-veud-copy">
												All existing items
												<select
													name="resolution"
													defaultValue="merge"
													className="min-h-10 rounded-lg border border-veud-border bg-veud-canvas px-2 text-veud-cream"
												>
													<option value="merge">Merge progress</option>
													<option value="replace">Replace Veud details</option>
													<option value="skip">Skip</option>
												</select>
											</label>
											<Button type="submit" variant="outline">
												Set conflicts
											</Button>
										</Form>
									) : null}
									<Form method="post">
										<input type="hidden" name="intent" value="apply" />
										<input type="hidden" name="batchId" value={selected.id} />
										<Button type="submit">Apply selected entries</Button>
									</Form>
									<Form method="post">
										<input type="hidden" name="intent" value="delete-preview" />
										<input type="hidden" name="batchId" value={selected.id} />
										<Button type="submit" variant="outline">
											Delete preview
										</Button>
									</Form>
								</>
							) : null}
							{selected.status === 'applied' ? (
								<Form method="post">
									<input type="hidden" name="intent" value="rollback" />
									<input type="hidden" name="batchId" value={selected.id} />
									<Button type="submit" variant="outline">
										Roll back import
									</Button>
								</Form>
							) : null}
						</div>
					</div>
					<dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
						{[
							['matched', selected.matchedCount],
							['ambiguous', selected.ambiguousCount],
							['unmatched', selected.unmatchedCount],
							['conflicts', selected.conflictCount],
						].map(([label, value]) => (
							<div
								key={label}
								className="rounded-xl border border-veud-border bg-black/15 p-3"
							>
								<dt className="text-xs font-black uppercase text-veud-copy">
									{label}
								</dt>
								<dd className="mt-1 text-2xl font-black text-veud-cream">
									{value}
								</dd>
							</div>
						))}
					</dl>
					<ul className="mt-5 grid gap-3">
						{selected.items.slice(0, 100).map(item => {
							const poster = splitLegacyThumbnail(item.mediaThumbnail).imageUrl
							return (
								<li
									key={item.id}
									className="rounded-xl border border-veud-border bg-black/10 p-4"
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="flex min-w-0 flex-1 gap-3">
											{poster ? (
												<img
													src={poster}
													alt=""
													loading="lazy"
													className="h-24 w-16 shrink-0 rounded-lg object-cover"
												/>
											) : null}
											<div className="min-w-0">
												<h3 className="font-black text-veud-cream">
													{item.source.title}
												</h3>
												<p className="text-xs capitalize text-veud-copy">
													{item.source.mediaKind} · {item.source.status}
													{item.source.score === null
														? ''
														: ` · ${item.source.score}/10`}
												</p>
												<p className="mt-1 text-sm text-veud-copy">
													{item.mediaTitle
														? `Matched ${item.mediaTitle}${item.matchMethod ? ` by ${item.matchMethod.replace('-', ' ')}` : ''}.`
														: item.matchState === 'ambiguous'
															? 'Choose the correct catalog result.'
															: 'No safe catalog match was found.'}
													{item.hasConflict
														? ' This item already has Veud tracking data; choose merge, replace, or skip.'
														: ''}
												</p>
												{item.aiHypotheses.length ? (
													<div className="mt-2 rounded-lg border border-veud-mint/25 bg-veud-mint/5 p-2 text-xs text-veud-copy">
														<strong className="text-veud-mint">
															AI title hypotheses:
														</strong>{' '}
														{item.aiHypotheses
															.map(
																hypothesis =>
																	`${hypothesis.title} (${hypothesis.uncertainty} uncertainty)`,
															)
															.join(' · ')}
														<p className="mt-1">
															Veud matched these phrases locally. No catalog
															candidate was sent to OpenAI and nothing is
															selected automatically.
														</p>
													</div>
												) : null}
											</div>
										</div>
										<span className="rounded-full border border-veud-border px-3 py-1 text-xs font-black capitalize text-veud-mint">
											{item.matchState}
										</span>
									</div>
									{selected.status === 'previewed' &&
									(item.mediaId || item.candidates.length) ? (
										<Form
											method="post"
											className="mt-3 flex flex-wrap items-end gap-3"
										>
											<input
												type="hidden"
												name="intent"
												value="update-choice"
											/>
											<input type="hidden" name="batchId" value={selected.id} />
											<input type="hidden" name="itemId" value={item.id} />
											<input type="hidden" name="page" value={selected.page} />
											{item.candidates.length ? (
												<label className="grid min-w-52 flex-1 gap-1 text-xs font-black text-veud-copy">
													Catalog match
													<select
														name="mediaId"
														defaultValue={item.mediaId ?? ''}
														className="min-h-10 rounded-lg border border-veud-border bg-veud-canvas px-2 text-veud-cream"
													>
														<option value="">Choose a match</option>
														{item.candidates.map(candidate => (
															<option
																key={candidate.mediaId}
																value={candidate.mediaId}
															>
																{candidate.title}
																{candidate.hasConflict
																	? ' (already on your list)'
																	: ''}
															</option>
														))}
													</select>
												</label>
											) : null}
											<label className="grid gap-1 text-xs font-black text-veud-copy">
												Action
												<select
													name="resolution"
													defaultValue={item.resolution}
													className="min-h-10 rounded-lg border border-veud-border bg-veud-canvas px-2 text-veud-cream"
												>
													{item.mediaId && item.hasConflict ? (
														<>
															<option value="merge">Merge progress</option>
															<option value="replace">
																Replace Veud details
															</option>
														</>
													) : item.mediaId ? (
														<option value="add">Add</option>
													) : item.candidates.length ? (
														<>
															<option value="add">Add</option>
															<option value="merge">Merge progress</option>
															<option value="replace">
																Replace Veud details
															</option>
														</>
													) : null}
													<option value="skip">Skip</option>
												</select>
											</label>
											<Button type="submit" variant="outline">
												Save choice
											</Button>
										</Form>
									) : null}
								</li>
							)
						})}
					</ul>
					{selected.pageCount > 1 ? (
						<nav
							aria-label="Import preview pages"
							className="mt-4 flex items-center justify-between gap-3 text-sm text-veud-copy"
						>
							{selected.page > 1 ? (
								<Link
									className="rounded-lg border border-veud-border px-3 py-2 font-black text-veud-cream"
									to={`/settings/profile/import?batch=${selected.id}&page=${selected.page - 1}`}
								>
									Previous
								</Link>
							) : (
								<span />
							)}
							<span>
								Page {selected.page} of {selected.pageCount}
							</span>
							{selected.page < selected.pageCount ? (
								<Link
									className="rounded-lg border border-veud-border px-3 py-2 font-black text-veud-cream"
									to={`/settings/profile/import?batch=${selected.id}&page=${selected.page + 1}`}
								>
									Next
								</Link>
							) : (
								<span />
							)}
						</nav>
					) : null}
					<p className="mt-5 rounded-xl border border-dashed border-veud-border p-4 text-sm text-veud-copy">
						Apply is transactional: every selected row succeeds together or no
						rows change. Rollback is available until a subsequently edited item
						would be overwritten. Any status lists created by this import start
						private.
					</p>
				</section>
			) : null}
		</div>
	)
}
