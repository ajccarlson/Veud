import { type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'
import {
	sitemapIndexXml,
	sitemapPageCount,
	xmlResponse,
} from '#app/utils/sitemap.server.ts'

/**
 * The index: the site's own pages, then the catalog in chunks.
 *
 * This used to be the route-manifest sitemap itself, which listed a few dozen
 * static paths and none of the media pages the catalog was ingested to have.
 * Those now live behind `/sitemap/media/:page.xml`, and the manifest keeps its
 * own entry at `/sitemap/pages.xml`.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const origin = getDomainUrl(request)
	const [total, newest] = await Promise.all([
		prisma.media.count({ where: { title: { not: null } } }),
		prisma.media.findFirst({
			where: { title: { not: null } },
			orderBy: { updatedAt: 'desc' },
			select: { updatedAt: true },
		}),
	])

	const pages = sitemapPageCount(total)
	return xmlResponse(
		sitemapIndexXml([
			{ loc: `${origin}/sitemap/pages.xml` },
			...Array.from({ length: pages }, (_, index) => ({
				loc: `${origin}/sitemap/media/${index + 1}.xml`,
				lastmod: newest?.updatedAt ?? null,
			})),
		]),
		// The set of chunks only changes when the catalog grows past a boundary.
		60 * 60,
	)
}
