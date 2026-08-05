import { data as json, type LoaderFunctionArgs } from 'react-router'
import { getSearchSuggestions } from '#app/utils/search-suggestions.server.ts'

/**
 * Suggestions for the site search bar.
 *
 * Public, because the search bar itself is: signing in changes nothing about
 * which catalog titles exist. Nothing viewer-specific is returned, so the
 * response carries no private data to leak.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const suggestions = await getSearchSuggestions({
		q: url.searchParams.get('q'),
		kind: url.searchParams.get('kind'),
		limit: url.searchParams.get('limit'),
	})
	return json(
		{ suggestions },
		{
			headers: {
				// Same catalog for everyone, and a keystroke away from being asked
				// again, so a shared short cache absorbs repeat typing without ever
				// showing one person another's results.
				'Cache-Control': 'public, max-age=30',
			},
		},
	)
}
