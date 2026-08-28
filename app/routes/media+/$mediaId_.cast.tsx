import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { type CastCard } from '#app/components/media-cast.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { getMediaFullCredits } from '#app/utils/media-credits.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'

export async function loader({ params }: LoaderFunctionArgs) {
	const mediaId = params['mediaId']
	invariantResponse(mediaId, 'Media not found', { status: 404 })

	const media = await prisma.media.findUnique({
		where: { id: mediaId },
		select: { id: true, kind: true, title: true, thumbnail: true },
	})
	invariantResponse(media, 'Media not found', { status: 404 })

	const credits = await getMediaFullCredits(prisma, media.id)

	return json({
		media: {
			id: media.id,
			kind: media.kind,
			title: media.title?.trim() || `Untitled ${media.kind}`,
			imageUrl: splitLegacyThumbnail(media.thumbnail).imageUrl,
		},
		...credits,
	})
}

/**
 * A row in a list, rather than a card in a strip.
 *
 * The full page is read rather than scanned — someone is here looking for a
 * particular name or a particular department — so it gives up the photographs
 * for density.
 */
function CreditRow({ credit }: { credit: CastCard }) {
	const episodes = credit.episodeCount
		? `${credit.episodeCount} ${credit.episodeCount === 1 ? 'episode' : 'episodes'}`
		: null
	return (
		<li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2 last:border-b-0">
			<Link
				to={`/people/${credit.person.id}`}
				className="font-semibold hover:underline"
			>
				{credit.person.name}
			</Link>
			<span className="text-sm text-muted-foreground">
				{credit.role || '—'}
				{episodes ? ` · ${episodes}` : ''}
			</span>
		</li>
	)
}

export default function MediaCastRoute() {
	const data = useLoaderData<typeof loader>()
	const nothing = !data.cast.length && !data.crew.length

	return (
		<main className="container space-y-8 py-8">
			<header className="space-y-2">
				<Link
					to={`/media/${data.media.id}`}
					prefetch="intent"
					className="text-sm font-semibold text-primary hover:underline"
				>
					← {data.media.title}
				</Link>
				<h1 className="text-3xl font-bold">Cast &amp; crew</h1>
			</header>

			{nothing ? (
				<p className="text-muted-foreground">
					No cast or crew has been recorded for this title yet.
				</p>
			) : null}

			<div className="grid gap-10 lg:grid-cols-2">
				{data.cast.length ? (
					<section aria-labelledby="full-cast-heading">
						<h2 id="full-cast-heading" className="text-2xl font-bold">
							Cast{' '}
							<span className="text-base font-normal text-muted-foreground">
								{data.cast.length}
							</span>
						</h2>
						<ul className="mt-3">
							{data.cast.map(credit => (
								<CreditRow key={credit.id} credit={credit} />
							))}
						</ul>
					</section>
				) : null}

				{data.crew.length ? (
					<section aria-labelledby="full-crew-heading" className="space-y-6">
						<h2 id="full-crew-heading" className="text-2xl font-bold">
							Crew
						</h2>
						{/* Grouped by department the way a call sheet is: you look for the
						    department first and the person second. */}
						{data.crew.map(group => (
							<div key={group.department}>
								<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
									{group.department}
								</h3>
								<ul className="mt-2">
									{group.credits.map(credit => (
										<CreditRow key={credit.id} credit={credit} />
									))}
								</ul>
							</div>
						))}
					</section>
				) : null}
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
	const title = loaderData
		? `${loaderData.media.title} — cast & crew | Veud`
		: 'Cast & crew | Veud'
	return [
		{ title },
		{
			name: 'description',
			content: loaderData
				? `Everyone credited on ${loaderData.media.title}, on Veud.`
				: 'Cast and crew on Veud',
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => <p>That media title could not be found.</p>,
			}}
		/>
	)
}
