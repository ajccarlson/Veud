import { type LoaderFunctionArgs } from 'react-router'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { robotsResponse, robotsTxt } from '#app/utils/sitemap.server.ts'

export function loader({ request }: LoaderFunctionArgs) {
	return robotsResponse(
		robotsTxt([
			{ type: 'sitemap', value: `${getDomainUrl(request)}/sitemap.xml` },
		]),
	)
}
