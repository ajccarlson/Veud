import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	Link,
	type LoaderFunctionArgs,
	type MetaFunction,
	useLoaderData,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { getPersonCredits } from '#app/utils/media-credits.server.ts'

export async function loader({ params }: LoaderFunctionArgs) {
	const personId = params['personId']
	invariantResponse(personId, 'Person not found', { status: 404 })

	const person = await prisma.person.findUnique({
		where: { id: personId },
		select: {
			id: true,
			name: true,
			imageUrl: true,
			knownForDepartment: true,
			biography: true,
			birthday: true,
			deathday: true,
			placeOfBirth: true,
		},
	})
	invariantResponse(person, 'Person not found', { status: 404 })

	const credits = await getPersonCredits(prisma, person.id)

	return json({ person, ...credits })
}

function displayDate(value: string | Date | null) {
	if (!value) return null
	const date = typeof value === 'string' ? new Date(value) : value
	return Number.isNaN(date.getTime())
		? null
		: date.toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				timeZone: 'UTC',
			})
}

function Fact({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) {
	if (!children) return null
	return (
		<div>
			<dt className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="font-medium">{children}</dd>
		</div>
	)
}

export default function PersonRoute() {
	const data = useLoaderData<typeof loader>()
	const { person } = data
	const born = displayDate(person.birthday)
	const died = displayDate(person.deathday)

	return (
		<main className="container space-y-10 py-8">
			<div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
				<aside className="space-y-5">
					<div className="aspect-[2/3] w-full max-w-64 overflow-hidden rounded-lg bg-muted">
						{person.imageUrl ? (
							<img
								src={person.imageUrl}
								alt=""
								className="h-full w-full object-cover"
							/>
						) : (
							<div
								aria-hidden="true"
								className="flex h-full w-full items-center justify-center text-4xl font-semibold text-muted-foreground"
							>
								{person.name.slice(0, 1).toUpperCase()}
							</div>
						)}
					</div>
					<dl className="space-y-4">
						<Fact label="Known for">{person.knownForDepartment}</Fact>
						<Fact label="Credits">{data.total || null}</Fact>
						<Fact label="Born">{born}</Fact>
						<Fact label="Died">{died}</Fact>
						<Fact label="Place of birth">{person.placeOfBirth}</Fact>
					</dl>
				</aside>

				<div className="space-y-8">
					<h1 className="text-4xl font-bold">{person.name}</h1>

					{person.biography ? (
						<section className="space-y-2">
							<h2 className="text-xl font-bold">Biography</h2>
							<p className="whitespace-pre-line leading-7 text-muted-foreground">
								{person.biography}
							</p>
						</section>
					) : null}

					{data.knownFor.length ? (
						<section className="space-y-3" aria-labelledby="known-for-heading">
							<h2 id="known-for-heading" className="text-xl font-bold">
								Known for
							</h2>
							{/* Ordered by how well known the title is rather than by date:
							    this strip is what someone is recognised for. */}
							<ul
								className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2"
								aria-label="Known for"
							>
								{data.knownFor.map(credit => (
									<li key={credit.id} className="w-32 shrink-0 sm:w-36">
										<Link
											to={`/media/${credit.media.id}`}
											prefetch="intent"
											className="block h-full rounded-lg border bg-background transition hover:border-primary"
										>
											<div className="aspect-[2/3] w-full overflow-hidden rounded-t-lg bg-muted">
												{credit.media.imageUrl ? (
													<img
														src={credit.media.imageUrl}
														alt=""
														loading="lazy"
														className="h-full w-full object-cover"
													/>
												) : null}
											</div>
											<p className="p-2 text-sm font-semibold leading-tight">
												{credit.media.title}
											</p>
										</Link>
									</li>
								))}
							</ul>
						</section>
					) : null}

					{data.filmography.length ? (
						data.filmography.map(group => (
							<section
								key={group.department}
								className="space-y-2"
								aria-labelledby={`credits-${group.department}`}
							>
								<h2
									id={`credits-${group.department}`}
									className="text-xl font-bold"
								>
									{group.department}
								</h2>
								<ul className="rounded-lg border">
									{group.credits.map(credit => (
										<li
											key={credit.id}
											className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0"
										>
											<span className="w-12 shrink-0 tabular-nums text-muted-foreground">
												{credit.year ?? '—'}
											</span>
											<Link
												to={`/media/${credit.media.id}`}
												prefetch="intent"
												className="font-semibold hover:underline"
											>
												{credit.media.title}
											</Link>
											{credit.role ? (
												<span className="text-sm text-muted-foreground">
													as {credit.role}
													{credit.episodeCount
														? ` · ${credit.episodeCount} ${
																credit.episodeCount === 1
																	? 'episode'
																	: 'episodes'
															}`
														: ''}
												</span>
											) : null}
										</li>
									))}
								</ul>
							</section>
						))
					) : (
						<p className="text-muted-foreground">
							Nothing in the catalog credits {person.name} yet.
						</p>
					)}
				</div>
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
	if (!loaderData) return [{ title: 'Person | Veud' }]
	const { person } = loaderData
	return [
		{ title: `${person.name} | Veud` },
		{
			name: 'description',
			content:
				person.biography?.slice(0, 200) ??
				`Everything ${person.name} is credited on, across Veud's catalog.`,
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: () => <p>Nobody by that id is in the catalog.</p>,
			}}
		/>
	)
}
