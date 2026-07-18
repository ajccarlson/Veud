import { invariantResponse } from '@epic-web/invariant'
import { type LoaderFunctionArgs } from 'react-router'
import { cache } from '#app/utils/cache.server.ts'
import {
	getAllInstances,
	getInstanceInfo,
	ensureInstance,
} from '#app/utils/litefs.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'

export async function loader({ request, params, url }: LoaderFunctionArgs) {
	await requireUserWithRole(request, 'admin', { url })
	const searchParams = url.searchParams
	const currentInstanceInfo = await getInstanceInfo()
	const allInstances = await getAllInstances()
	const instance =
		searchParams.get('instance') ?? currentInstanceInfo.currentInstance
	await ensureInstance(instance)

	const { cacheKey } = params
	invariantResponse(cacheKey, 'cacheKey is required')
	return Response.json({
		instance: {
			hostname: instance,
			region: allInstances[instance],
			isPrimary: currentInstanceInfo.primaryInstance === instance,
		},
		cacheKey,
		value: cache.get(cacheKey),
	})
}
