import { data as json, type LoaderFunctionArgs } from 'react-router'
import { getViewerTitleLanguage } from '#app/utils/media-title.server.ts'
import { getSearchSuggestions } from '#app/utils/search-suggestions.server.ts'

/**
 * Suggestions for the site search bar.
 *
 * The search bar itself is public: signing in changes nothing about which
 * catalog titles exist. What it can change is what they are *called* — a member
 * who asked for English anime titles must be offered the same names the rest of
 * the site shows them, or the row they click is not the row they were shown.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const titleLanguage = await getViewerTitleLanguage(request)
	const suggestions = await getSearchSuggestions({
		q: url.searchParams.get('q'),
		kind: url.searchParams.get('kind'),
		limit: url.searchParams.get('limit'),
		titleLanguage,
	})
	return json(
		{ suggestions },
		{
			headers: {
				// Private rather than public: the titles depend on the viewer's
				// language preference, so a shared cache would answer one member with
				// another's names. Still cached briefly, which is what absorbs repeat
				// typing — that was always the part doing the work, not the sharing.
				'Cache-Control': 'private, max-age=30',
			},
		},
	)
}
