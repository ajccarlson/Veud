import { type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { cache } from '#app/utils/cache.server.ts'
import { isInternalCommandAuthorized } from '#app/utils/internal-command.server.ts'
import { getInstanceInfo } from '#app/utils/litefs.server'

export async function action({ request }: ActionFunctionArgs) {
	const { currentIsPrimary, primaryInstance } = await getInstanceInfo()
	if (!currentIsPrimary) {
		throw new Error(
			`${request.url} should only be called on the primary instance (${primaryInstance})}`,
		)
	}
	if (!isInternalCommandAuthorized(request)) {
		return Response.json(
			{ success: false, error: 'Unauthorized' },
			{
				status: 401,
				headers: { 'WWW-Authenticate': 'Bearer' },
			},
		)
	}
	const { key, cacheValue } = z
		.object({ key: z.string(), cacheValue: z.unknown().optional() })
		.parse(await request.json())
	if (cacheValue === undefined) {
		await cache.delete(key)
	} else {
		// @ts-expect-error - we don't reliably know the type of cacheValue
		await cache.set(key, cacheValue)
	}
	return Response.json({ success: true })
}
