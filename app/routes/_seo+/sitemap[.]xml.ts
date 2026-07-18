import { generateSitemap } from '@nasa-gcn/remix-seo'
import { type LoaderFunctionArgs } from 'react-router'
import { serverBuildContext } from '#app/env.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'

export async function loader({ request, context }: LoaderFunctionArgs) {
	const serverBuild = await context.get(serverBuildContext)
	return generateSitemap(
		request,
		serverBuild.routes as unknown as Parameters<typeof generateSitemap>[1],
		{
			siteUrl: getDomainUrl(request),
			headers: {
				'Cache-Control': `public, max-age=${60 * 5}`,
			},
		},
	)
}
