import { json, redirect, type LoaderFunctionArgs } from '@remix-run/node'
import { Link, useLoaderData } from '@remix-run/react'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList } from '#app/components/forms.tsx'
import { MediaSearchBar } from '#app/components/search-add-watchlist-entry.tsx'
import { searchTMDB } from "#app/routes/media+/tmdb.jsx"
import { cn, useDelayedIsPending } from '#app/utils/misc.tsx'

export async function loader({ request }: LoaderFunctionArgs) {
	const searchTerm = new URL(request.url).searchParams.get('search')
	if (searchTerm === '') {
		return redirect('/media')
	}

	const results = await searchTMDB(searchTerm, "movie")

	if (!results) {
		return json({ status: 'error', error: "No data found!" } as const, {
			status: 400,
		})
	}
	return json({ status: 'idle', media: results } as const)
}

export default function MediaRoute() {
	const data = useLoaderData<typeof loader>()
	const isPending = useDelayedIsPending({
		formMethod: 'GET',
		formAction: '/media',
	})

	if (data.status === 'error') {
		console.error(data.error)
	}

	return (
		<div className="container mb-48 mt-36 flex flex-col items-center justify-center gap-6">
			<h1 className="text-h1">Media Results</h1>
			<div className="w-full max-w-[700px]">
				<MediaSearchBar status={data.status} autoFocus autoSubmit />
			</div>
			<main>
				{data.status === 'idle' ? (
					data.media.length ? (
						<ul
							className={cn(
								'flex w-full flex-wrap items-center justify-center gap-4 delay-200',
								{ 'opacity-50': isPending },
							)}
						>
							{data.media.map((media: any) => (
								<li key={media.id}>
									<Link
										to={media.title}
										className="flex h-36 w-44 flex-col items-center justify-center rounded-lg bg-muted px-5 py-3"
									>
										<img
											alt={media.title ?? media.original_title}
											src={media.poster_path}
											className="h-16 w-16 rounded-full"
										/>
										{media.title ? (
											<span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-center text-body-md">
												{media.title}
											</span>
										) : null}
										<span className="w-full overflow-hidden text-ellipsis text-center text-body-sm text-muted-foreground">
											{media.original_title}
										</span>
									</Link>
								</li>
							))}
						</ul>
					) : (
						<p>No media found</p>
					)
				) : data.status === 'error' ? (
					<ErrorList errors={['There was an error parsing the results']} />
				) : null}
			</main>
		</div>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
