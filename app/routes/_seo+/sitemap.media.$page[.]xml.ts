import { type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'
import {
	SITEMAP_PAGE_SIZE,
	parseSitemapPage,
	urlSetXml,
	xmlResponse,
} from '#app/utils/sitemap.server.ts'

/**
 * One chunk of catalog pages.
 *
 * Ordered by id, which is the primary key, so the read is an index scan and the
 * chunk boundaries stay stable between crawls — a sitemap whose contents shuffle
 * is worse than none. Untitled rows are skipped: hydration can create a record
 * before a provider has given it a title, and a page with no title is not one
 * to invite a crawler to.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
	const page = parseSitemapPage(params['page'])
	if (!page) {
		throw new Response('Not found', { status: 404 })
	}

	const media = await prisma.media.findMany({
		where: { title: { not: null } },
		orderBy: { id: 'asc' },
		select: { id: true, updatedAt: true },
		skip: (page - 1) * SITEMAP_PAGE_SIZE,
		take: SITEMAP_PAGE_SIZE,
	})
	if (!media.length) {
		throw new Response('Not found', { status: 404 })
	}

	const origin = getDomainUrl(request)
	return xmlResponse(
		urlSetXml(
			media.map(item => ({
				loc: `${origin}/media/${item.id}`,
				lastmod: item.updatedAt,
				changefreq: 'weekly',
			})),
		),
		60 * 60 * 6,
	)
}
