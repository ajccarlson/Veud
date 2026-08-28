import { type LoaderFunctionArgs } from 'react-router'
import { serverBuildContext } from '#app/env.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'
import {
	publicPageSitemapPaths,
	urlSetXml,
	xmlResponse,
} from '#app/utils/sitemap.server.ts'

/**
 * The site's own pages.
 *
 * This walked the route manifest through `generateSitemap`, which emits every
 * route that has a path and a component. That included the catch-all as a
 * literal `/*` — a URL that always 404s — along with `/login`, `/logout`,
 * `/verify` and the whole admin and moderation surface. Auto-discovery is worth
 * keeping, so the walk stays and the exclusions are explicit and tested.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
	const serverBuild = await context.get(serverBuildContext)
	const origin = getDomainUrl(request)
	const paths = publicPageSitemapPaths(
		serverBuild.routes as unknown as Parameters<
			typeof publicPageSitemapPaths
		>[0],
	)
	return xmlResponse(
		urlSetXml(paths.map(path => ({ loc: `${origin}${path}` }))),
		60 * 60,
	)
}
