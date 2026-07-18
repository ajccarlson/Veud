import { invariantResponse } from '@epic-web/invariant'
import { type Prisma } from '@prisma/client'
import {
	data as json,
	Form,
	Link,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { getUserId, requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	mediaCatalogSelect,
	resolveMediaCatalog,
	type MediaCatalogSnapshot,
} from '#app/utils/media-catalog.ts'
import {
	externalMediaUrl,
	legacyProgressUpdate,
	listTypeNameForMediaKind,
	progressUnitsForMediaKind,
	splitLegacyThumbnail,
	totalFromLegacyCounter,
} from '#app/utils/media-detail.ts'
import { ensureTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import {
	trackingStateFromEntry,
	type TrackingEntryLike,
} from '#app/utils/tracking-state.ts'

const catalogEntrySelect = {
	id: true,
	thumbnail: true,
	title: true,
	type: true,
	releaseStart: true,
	releaseEnd: true,
	nextRelease: true,
	genres: true,
	description: true,
	airYear: true,
	startSeason: true,
	startYear: true,
	length: true,
	chapters: true,
	volumes: true,
	rating: true,
	language: true,
	studios: true,
	serialization: true,
	authors: true,
	tmdbScore: true,
	malScore: true,
} satisfies Prisma.EntrySelect

type CatalogEntry = Prisma.EntryGetPayload<{
	select: typeof catalogEntrySelect
}>

const ActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('status'),
		watchlistId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('score'),
		score: z.coerce.number().min(0).max(10),
	}),
	z.object({
		intent: z.literal('progress'),
		unit: z.enum(['episode', 'chapter', 'volume']),
		current: z.coerce.number().int().min(0).max(1_000_000),
	}),
])

function catalogRichness(entry: CatalogEntry) {
	return (
		(entry.thumbnail ? 4 : 0) +
		(entry.description?.length ?? 0) +
		(entry.genres ? 2 : 0) +
		(entry.releaseStart ? 2 : 0) +
		(entry.length || entry.chapters || entry.volumes ? 2 : 0)
	)
}

function representativeEntry(entries: CatalogEntry[]) {
	return entries
		.slice()
		.sort(
			(a, b) =>
				catalogRichness(b) - catalogRichness(a) || a.id.localeCompare(b.id),
		)[0]
}

function catalogCreateData(
	entry: MediaCatalogSnapshot | undefined,
	kind: string,
) {
	return {
		thumbnail: entry?.thumbnail,
		title: entry?.title?.trim() || `Untitled ${kind}`,
		type: entry?.type,
		releaseStart: entry?.releaseStart,
		releaseEnd: entry?.releaseEnd,
		nextRelease: entry?.nextRelease,
		genres: entry?.genres,
		description: entry?.description,
		airYear: entry?.airYear,
		startSeason: entry?.startSeason,
		startYear: entry?.startYear,
		length: entry?.length,
		chapters: entry?.chapters,
		volumes: entry?.volumes,
		rating: entry?.rating,
		language: entry?.language,
		studios: entry?.studios,
		serialization: entry?.serialization,
		authors: entry?.authors,
		tmdbScore: entry?.tmdbScore,
		malScore: entry?.malScore,
	}
}

function progressTotal(entry: MediaCatalogSnapshot | undefined, unit: string) {
	if (unit === 'episode') return totalFromLegacyCounter(entry?.length)
	if (unit === 'chapter') return totalFromLegacyCounter(entry?.chapters)
	if (unit === 'volume') return totalFromLegacyCounter(entry?.volumes)
	return null
}

function progressLabel(unit: string) {
	if (unit === 'episode') return 'Episodes watched'
	if (unit === 'chapter') return 'Chapters read'
	if (unit === 'volume') return 'Volumes read'
	return `${unit} progress`
}

function displayDate(value: Date | string | null | undefined) {
	if (!value) return '—'
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const mediaId = params.mediaId
	invariantResponse(mediaId, 'Media not found', { status: 404 })
	const viewerId = await getUserId(request)
	const media = await prisma.media.findUnique({
		where: { id: mediaId },
		select: {
			id: true,
			kind: true,
			...mediaCatalogSelect,
			externalIds: {
				select: { provider: true, kind: true, externalId: true },
				orderBy: [{ provider: 'asc' }, { externalId: 'asc' }],
			},
			entries: { select: catalogEntrySelect },
		},
	})
	invariantResponse(media, 'Media not found', { status: 404 })

	const catalog = resolveMediaCatalog(
		media,
		representativeEntry(media.entries),
	)
	const listTypeName = listTypeNameForMediaKind(media.kind)
	const [community, viewerState, viewerEntries, viewerWatchlists] =
		await Promise.all([
			prisma.trackingState.aggregate({
				where: { mediaId: media.id },
				_count: { id: true, score: true },
				_avg: { score: true },
			}),
			viewerId
				? prisma.trackingState.findUnique({
						where: {
							ownerId_mediaId: { ownerId: viewerId, mediaId: media.id },
						},
						select: {
							status: true,
							statusWatchlistId: true,
							score: true,
							startedAt: true,
							completedAt: true,
							repeatCount: true,
							progress: {
								select: { unit: true, current: true, total: true },
							},
						},
					})
				: null,
			viewerId
				? prisma.entry.findMany({
						where: { mediaId: media.id, watchlist: { ownerId: viewerId } },
						include: {
							watchlist: { select: { id: true, name: true } },
						},
					})
				: [],
			viewerId && listTypeName
				? prisma.watchlist.findMany({
						where: { ownerId: viewerId, type: { name: listTypeName } },
						select: { id: true, name: true, header: true, position: true },
						orderBy: [{ position: 'asc' }, { header: 'asc' }],
					})
				: [],
		])

	const legacyTracking = viewerEntries
		.map(entry => ({
			entry,
			snapshot: trackingStateFromEntry(entry, {
				status: entry.watchlist.name,
				statusWatchlistId: entry.watchlist.id,
				mediaKind: media.kind,
			}),
		}))
		.sort(
			(a, b) =>
				b.snapshot.sourceUpdatedAt - a.snapshot.sourceUpdatedAt ||
				a.entry.id.localeCompare(b.entry.id),
		)[0]?.snapshot
	const tracking = viewerState
		? {
				status: viewerState.status,
				statusWatchlistId: viewerState.statusWatchlistId,
				score: viewerState.score ? Number(viewerState.score) : null,
				startedAt: viewerState.startedAt,
				completedAt: viewerState.completedAt,
				repeatCount: viewerState.repeatCount,
				progress: viewerState.progress,
			}
		: legacyTracking
			? {
					status: legacyTracking.status,
					statusWatchlistId: legacyTracking.statusWatchlistId,
					score: legacyTracking.score,
					startedAt: legacyTracking.startedAt,
					completedAt: legacyTracking.completedAt,
					repeatCount: legacyTracking.repeatCount,
					progress: legacyTracking.progress,
				}
			: null
	const progress = progressUnitsForMediaKind(media.kind).map(unit => {
		const saved = tracking?.progress.find(progress => progress.unit === unit)
		return {
			unit,
			current: saved?.current ?? 0,
			total: saved?.total ?? progressTotal(catalog, unit),
		}
	})
	const thumbnail = splitLegacyThumbnail(catalog?.thumbnail)

	return json({
		media: {
			id: media.id,
			kind: media.kind,
			title: catalog?.title?.trim() || `Untitled ${media.kind}`,
			type: catalog?.type,
			description: catalog?.description,
			genres: catalog?.genres,
			releaseStart: catalog?.releaseStart,
			releaseEnd: catalog?.releaseEnd,
			imageUrl: thumbnail.imageUrl,
			externalLinks: media.externalIds
				.map(identity => ({
					...identity,
					url: externalMediaUrl(identity),
				}))
				.filter(link => link.url !== null),
		},
		community: {
			trackers: community._count.id,
			ratings: community._count.score,
			meanScore: community._avg.score ? Number(community._avg.score) : null,
		},
		viewer: viewerId
			? { tracking, watchlists: viewerWatchlists, progress }
			: null,
	})
}

function authoritativeEntry<
	T extends TrackingEntryLike & {
		id: string
		watchlistId: string
		watchlist: { id: string; name: string }
	},
>(entries: T[], mediaKind: string, statusWatchlistId?: string | null) {
	const statusEntry = statusWatchlistId
		? entries.find(entry => entry.watchlistId === statusWatchlistId)
		: null
	if (statusEntry) return statusEntry
	return entries.slice().sort((a, b) => {
		const aUpdated = trackingStateFromEntry(a, {
			status: a.watchlist.name,
			statusWatchlistId: a.watchlist.id,
			mediaKind,
		}).sourceUpdatedAt
		const bUpdated = trackingStateFromEntry(b, {
			status: b.watchlist.name,
			statusWatchlistId: b.watchlist.id,
			mediaKind,
		}).sourceUpdatedAt
		return bUpdated - aUpdated || a.id.localeCompare(b.id)
	})[0]
}

async function renumberWatchlist(
	tx: Prisma.TransactionClient,
	watchlistId: string,
) {
	const entries = await tx.entry.findMany({
		where: { watchlistId },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
		select: { id: true, position: true },
	})
	for (const [index, entry] of entries.entries()) {
		if (entry.position === index + 1) continue
		await tx.entry.update({
			where: { id: entry.id },
			data: { position: index + 1 },
		})
	}
}

export async function action({ request, params }: ActionFunctionArgs) {
	const mediaId = params.mediaId
	invariantResponse(mediaId, 'Media not found', { status: 404 })
	const userId = await requireUserId(request)
	const parsed = ActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success)
		throw new Response('Invalid tracking update', { status: 400 })

	return prisma.$transaction(async tx => {
		const media = await tx.media.findUnique({
			where: { id: mediaId },
			select: {
				id: true,
				kind: true,
				...mediaCatalogSelect,
				entries: { select: catalogEntrySelect },
			},
		})
		if (!media) throw new Response('Media not found', { status: 404 })
		const listTypeName = listTypeNameForMediaKind(media.kind)
		if (!listTypeName)
			throw new Response('Unsupported media kind', { status: 400 })
		const catalog = resolveMediaCatalog(
			media,
			representativeEntry(media.entries),
		)
		let entries = await tx.entry.findMany({
			where: { mediaId, watchlist: { ownerId: userId } },
			include: { watchlist: true, media: true },
		})
		let state = await tx.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId: userId, mediaId } },
			select: { id: true, statusWatchlistId: true },
		})

		if (parsed.data.intent === 'status') {
			const destination = await tx.watchlist.findFirst({
				where: {
					id: parsed.data.watchlistId,
					ownerId: userId,
					type: { name: listTypeName },
				},
			})
			if (!destination) {
				throw new Response('Tracking status not found', { status: 400 })
			}

			let target = entries.find(entry => entry.watchlistId === destination.id)
			if (!target) {
				const maxPosition = await tx.entry.aggregate({
					where: { watchlistId: destination.id },
					_max: { position: true },
				})
				const primary = authoritativeEntry(
					entries,
					media.kind,
					state?.statusWatchlistId,
				)
				if (primary) {
					const sourceWatchlistId = primary.watchlistId
					await tx.entry.update({
						where: { id: primary.id },
						data: {
							watchlistId: destination.id,
							position: (maxPosition._max.position ?? 0) + 1,
						},
					})
					if (sourceWatchlistId !== destination.id) {
						await renumberWatchlist(tx, sourceWatchlistId)
					}
				} else {
					await tx.entry.create({
						data: {
							...catalogCreateData(catalog, media.kind),
							watchlistId: destination.id,
							mediaId,
							position: (maxPosition._max.position ?? 0) + 1,
							history: JSON.stringify({
								added: Date.now(),
								started: null,
								finished: null,
								progress: null,
								lastUpdated: Date.now(),
							}),
						},
					})
				}
				entries = await tx.entry.findMany({
					where: { mediaId, watchlist: { ownerId: userId } },
					include: { watchlist: true, media: true },
				})
				target = entries.find(entry => entry.watchlistId === destination.id)
			}
			if (!target) throw new Response('Unable to track media', { status: 500 })

			if (!state) {
				const stateId = await ensureTrackingStateForEntry(tx, {
					ownerId: userId,
					mediaId,
					mediaKind: media.kind,
					status: destination.name,
					statusWatchlistId: destination.id,
					entry: target,
					mode: 'status',
				})
				state = { id: stateId, statusWatchlistId: destination.id }
			} else {
				await tx.trackingState.update({
					where: { id: state.id },
					data: {
						status: destination.name,
						statusWatchlistId: destination.id,
					},
				})
			}
			await tx.entry.updateMany({
				where: { mediaId, watchlist: { ownerId: userId } },
				data: { trackingStateId: state.id },
			})
			return json({ ok: true })
		}

		const primary = authoritativeEntry(
			entries,
			media.kind,
			state?.statusWatchlistId,
		)
		if (!primary) {
			throw new Response('Choose a status before editing tracking data', {
				status: 400,
			})
		}
		if (!state) {
			const stateId = await ensureTrackingStateForEntry(tx, {
				ownerId: userId,
				mediaId,
				mediaKind: media.kind,
				status: primary.watchlist.name,
				statusWatchlistId: primary.watchlist.id,
				entry: primary,
				mode: 'all',
			})
			state = { id: stateId, statusWatchlistId: primary.watchlist.id }
		}
		await tx.entry.updateMany({
			where: { mediaId, watchlist: { ownerId: userId } },
			data: { trackingStateId: state.id },
		})

		if (parsed.data.intent === 'score') {
			await tx.trackingState.update({
				where: { id: state.id },
				data: { score: parsed.data.score > 0 ? parsed.data.score : null },
			})
			await tx.entry.updateMany({
				where: { mediaId, watchlist: { ownerId: userId } },
				data: { personal: parsed.data.score },
			})
			return json({ ok: true })
		}

		if (!progressUnitsForMediaKind(media.kind).includes(parsed.data.unit)) {
			throw new Response('Progress unit does not match this media', {
				status: 400,
			})
		}
		const savedProgress = await tx.trackingProgress.findUnique({
			where: {
				trackingStateId_unit: {
					trackingStateId: state.id,
					unit: parsed.data.unit,
				},
			},
		})
		const total =
			savedProgress?.total ??
			progressTotal(primary, parsed.data.unit) ??
			progressTotal(catalog, parsed.data.unit)
		if (total !== null && parsed.data.current > total) {
			throw new Response('Progress cannot exceed the known total', {
				status: 400,
			})
		}
		const previousCurrent = savedProgress?.current ?? 0
		await tx.trackingProgress.upsert({
			where: {
				trackingStateId_unit: {
					trackingStateId: state.id,
					unit: parsed.data.unit,
				},
			},
			update: { current: parsed.data.current, total },
			create: {
				trackingStateId: state.id,
				unit: parsed.data.unit,
				current: parsed.data.current,
				total,
			},
		})
		const now = Date.now()
		await tx.entry.update({
			where: { id: primary.id },
			data: legacyProgressUpdate(primary, {
				unit: parsed.data.unit,
				current: parsed.data.current,
				previousCurrent,
				total,
				now,
			}) as Prisma.EntryUpdateInput,
		})
		return json({ ok: true })
	})
}

export default function MediaDetailRoute() {
	const data = useLoaderData<typeof loader>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'
	const tracking = data.viewer?.tracking

	return (
		<main className="mx-auto w-full max-w-6xl px-4 py-8 text-foreground">
			<div className="grid gap-8 md:grid-cols-[16rem_minmax(0,1fr)]">
				<aside className="space-y-4">
					<div className="aspect-[2/3] overflow-hidden rounded-xl bg-muted shadow-lg">
						{data.media.imageUrl ? (
							<img
								src={data.media.imageUrl}
								alt={`${data.media.title} cover`}
								className="h-full w-full object-cover"
							/>
						) : (
							<div className="flex h-full items-center justify-center text-muted-foreground">
								No cover
							</div>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						{data.media.externalLinks.map(link => (
							<Button
								asChild
								variant="outline"
								size="sm"
								key={`${link.provider}-${link.externalId}`}
							>
								<a href={link.url ?? '#'} target="_blank" rel="noreferrer">
									{link.provider.toUpperCase()}
								</a>
							</Button>
						))}
					</div>
				</aside>

				<div className="space-y-8">
					<header className="space-y-2">
						<div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							{data.media.kind}
							{data.media.type ? ` · ${data.media.type}` : ''}
						</div>
						<h1 className="text-4xl font-bold">{data.media.title}</h1>
						<div className="text-sm text-muted-foreground">
							{displayDate(data.media.releaseStart)} –{' '}
							{displayDate(data.media.releaseEnd)}
						</div>
					</header>

					<section className="grid gap-3 sm:grid-cols-3">
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">
								{data.community.trackers}
							</div>
							<div className="text-sm text-muted-foreground">
								Members tracking
							</div>
						</div>
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">
								{data.community.meanScore?.toFixed(2) ?? '—'}
							</div>
							<div className="text-sm text-muted-foreground">
								Community score
							</div>
						</div>
						<div className="rounded-xl border bg-card p-4">
							<div className="text-2xl font-bold">{data.community.ratings}</div>
							<div className="text-sm text-muted-foreground">Ratings</div>
						</div>
					</section>

					{data.viewer ? (
						<section className="space-y-5 rounded-xl border bg-card p-5">
							<h2 className="text-xl font-bold">Your tracking</h2>
							{data.viewer.watchlists.length ? (
								<Form method="post" className="flex flex-wrap items-end gap-3">
									<input type="hidden" name="intent" value="status" />
									<div className="min-w-52 flex-1 space-y-2">
										<Label htmlFor="tracking-status">Status</Label>
										<select
											id="tracking-status"
											name="watchlistId"
											defaultValue={
												tracking?.statusWatchlistId ??
												data.viewer.watchlists[0]?.id
											}
											className="h-10 w-full rounded-md border bg-background px-3 text-sm"
										>
											{data.viewer.watchlists.map(watchlist => (
												<option value={watchlist.id} key={watchlist.id}>
													{watchlist.header}
												</option>
											))}
										</select>
									</div>
									<Button type="submit" disabled={busy}>
										Save status
									</Button>
								</Form>
							) : (
								<p className="text-sm text-muted-foreground">
									Create a compatible watchlist before tracking this title.
								</p>
							)}

							<div className="grid gap-4 sm:grid-cols-2">
								<Form method="post" className="space-y-2">
									<input type="hidden" name="intent" value="score" />
									<Label htmlFor="tracking-score">Score</Label>
									<div className="flex gap-2">
										<Input
											id="tracking-score"
											name="score"
											type="number"
											min="0"
											max="10"
											step="0.1"
											defaultValue={tracking?.score ?? 0}
											disabled={!tracking || busy}
										/>
										<Button
											type="submit"
											variant="outline"
											disabled={!tracking || busy}
										>
											Save
										</Button>
									</div>
								</Form>
								{data.viewer.progress.map(progress => (
									<Form method="post" className="space-y-2" key={progress.unit}>
										<input type="hidden" name="intent" value="progress" />
										<input type="hidden" name="unit" value={progress.unit} />
										<Label htmlFor={`progress-${progress.unit}`}>
											{progressLabel(progress.unit)}
										</Label>
										<div className="flex items-center gap-2">
											<Input
												id={`progress-${progress.unit}`}
												name="current"
												type="number"
												min="0"
												max={progress.total ?? undefined}
												defaultValue={progress.current}
												disabled={!tracking || busy}
											/>
											{progress.total ? (
												<span className="text-sm text-muted-foreground">
													/ {progress.total}
												</span>
											) : null}
											<Button
												type="submit"
												variant="outline"
												disabled={!tracking || busy}
											>
												Save
											</Button>
										</div>
									</Form>
								))}
							</div>
							{tracking ? (
								<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
									<span>Started {displayDate(tracking.startedAt)}</span>
									<span>Completed {displayDate(tracking.completedAt)}</span>
									{tracking.repeatCount > 0 ? (
										<span>{tracking.repeatCount} repeats</span>
									) : null}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									Choose a status to add this title to your library.
								</p>
							)}
						</section>
					) : (
						<section className="rounded-xl border bg-card p-5">
							<p className="text-muted-foreground">
								<Link
									to={`/login?redirectTo=/media/${data.media.id}`}
									className="font-semibold underline"
								>
									Log in
								</Link>{' '}
								to track, score, and update progress.
							</p>
						</section>
					)}

					<section className="space-y-3">
						<h2 className="text-2xl font-bold">Overview</h2>
						<p className="whitespace-pre-line leading-7 text-muted-foreground">
							{data.media.description || 'No description is available yet.'}
						</p>
						{data.media.genres ? (
							<p className="text-sm text-muted-foreground">
								<strong className="text-foreground">Genres:</strong>{' '}
								{data.media.genres}
							</p>
						) : null}
					</section>
				</div>
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
	{ title: data ? `${data.media.title} | Veud` : 'Media | Veud' },
	{
		name: 'description',
		content:
			data?.media.description ?? 'Media details and community tracking on Veud',
	},
]

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => <p>That media title could not be found.</p>,
			}}
		/>
	)
}
