import { Link } from 'react-router'

export type CastCard = {
	id: string
	role: string
	department: string
	episodeCount: number | null
	person: {
		id: string
		name: string
		imageUrl: string | null
		knownForDepartment: string | null
	}
}

/**
 * A person with no portrait.
 *
 * Their initials rather than a generic silhouette: a wall of identical
 * anonymous shapes is harder to read than a wall of different letters, and the
 * strip is scanned rather than read.
 */
function PersonInitials({ name }: { name: string }) {
	const initials = name
		.split(' ')
		.filter(Boolean)
		.slice(0, 2)
		.map(part => part[0])
		.join('')
		.toUpperCase()
	return (
		<div
			aria-hidden="true"
			className="flex h-full w-full items-center justify-center bg-muted text-2xl font-semibold text-muted-foreground"
		>
			{initials || '?'}
		</div>
	)
}

function PersonPortrait({
	name,
	imageUrl,
}: {
	name: string
	imageUrl: string | null
}) {
	return (
		<div className="aspect-[2/3] w-full overflow-hidden rounded-t-lg bg-muted">
			{imageUrl ? (
				<img
					src={imageUrl}
					alt=""
					loading="lazy"
					className="h-full w-full object-cover"
				/>
			) : (
				<PersonInitials name={name} />
			)}
		</div>
	)
}

function episodeLabel(episodeCount: number | null) {
	if (!episodeCount) return null
	return `${episodeCount} ${episodeCount === 1 ? 'episode' : 'episodes'}`
}

/**
 * One card in the billed strip.
 *
 * The whole card is the link rather than just the name, because the name is a
 * small target beside a large photograph that looks like it should be
 * clickable.
 *
 * Deliberately not prefetched on hover. A person page enriches itself from the
 * provider on first view, so prefetching would turn sweeping the mouse across a
 * cast row into that many live provider calls and catalog writes, for pages
 * nobody opened. Prefetch belongs back here once enrichment is off the loader's
 * critical path.
 */
function CastCardLink({ credit }: { credit: CastCard }) {
	const episodes = episodeLabel(credit.episodeCount)
	return (
		<li className="w-32 shrink-0 sm:w-36">
			<Link
				to={`/people/${credit.person.id}`}
				className="block h-full rounded-lg border bg-background transition hover:border-primary"
			>
				<PersonPortrait
					name={credit.person.name}
					imageUrl={credit.person.imageUrl}
				/>
				<div className="space-y-0.5 p-2">
					<p className="text-sm font-semibold leading-tight">
						{credit.person.name}
					</p>
					{credit.role ? (
						<p className="text-xs leading-tight text-muted-foreground">
							{credit.role}
						</p>
					) : null}
					{episodes ? (
						<p className="text-xs text-muted-foreground">{episodes}</p>
					) : null}
				</div>
			</Link>
		</li>
	)
}

/**
 * The billed cast, as a strip that scrolls sideways.
 *
 * Sideways rather than wrapped so the section stays one screen tall on a page
 * that already has a lot below it, and so the billing order reads as an order
 * rather than as rows.
 */
export function TopBilledCast({
	cast,
	total,
	mediaId,
}: {
	cast: CastCard[]
	total: number
	mediaId: string
}) {
	if (!cast.length) return null

	return (
		<section className="space-y-3" aria-labelledby="cast-heading">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="cast-heading" className="text-2xl font-bold">
					Top billed cast
				</h2>
				<Link
					to={`/media/${mediaId}/cast`}
					prefetch="intent"
					className="text-sm font-semibold text-primary hover:underline"
				>
					Full cast &amp; crew
				</Link>
			</div>
			{/* No tab stop of its own: every card is a link, so tabbing already
			    walks the strip and the browser scrolls each card into view as it
			    takes focus. A focusable container would only add a stop that lands
			    nowhere. */}
			<ul
				className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2"
				aria-label="Top billed cast"
			>
				{cast.map(credit => (
					<CastCardLink key={credit.id} credit={credit} />
				))}
				{total > cast.length ? (
					<li className="flex w-32 shrink-0 items-center sm:w-36">
						<Link
							to={`/media/${mediaId}/cast`}
							prefetch="intent"
							className="flex h-full w-full items-center justify-center rounded-lg border border-dashed p-3 text-center text-sm font-semibold text-primary hover:border-primary"
						>
							View all {total}
						</Link>
					</li>
				) : null}
			</ul>
		</section>
	)
}

/**
 * The line beneath the overview: director, writer, creator.
 *
 * Answers "whose is this?" without becoming the crew list that has its own
 * page.
 */
export function KeyCrew({ crew }: { crew: CastCard[] }) {
	if (!crew.length) return null
	return (
		<dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
			{crew.map(credit => (
				<div key={credit.id}>
					<dt className="text-xs uppercase tracking-wide text-muted-foreground">
						{credit.role}
					</dt>
					<dd>
						<Link
							to={`/people/${credit.person.id}`}
							className="font-semibold hover:underline"
						>
							{credit.person.name}
						</Link>
					</dd>
				</div>
			))}
		</dl>
	)
}
