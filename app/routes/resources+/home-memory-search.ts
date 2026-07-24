import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import {
	getDiscoveryResultsForMediaIds,
	parseDiscoveryQuery,
} from '#app/utils/discovery.server.ts'
import { getTipOfTongueMatches } from '#app/utils/tip-of-tongue.server.ts'

const AnonymousMemorySearchSchema = z.object({
	q: z.string().trim().min(3).max(500),
	kind: z.enum(['all', 'movie', 'tv', 'anime', 'manga']).default('all'),
})

export async function action({ request }: ActionFunctionArgs) {
	const fields = AnonymousMemorySearchSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!fields.success) {
		return json(
			{ ok: false as const, error: 'Add at least three characters.' },
			{ status: 400 },
		)
	}

	const result = await getTipOfTongueMatches(
		{ memory: fields.data.q, kind: fields.data.kind },
		{ allowAi: false },
	)
	const filters = parseDiscoveryQuery(
		new URLSearchParams({
			q: fields.data.q,
			kind: fields.data.kind,
			mode: 'memory',
		}),
	)
	const discovery = await getDiscoveryResultsForMediaIds(
		filters,
		null,
		result.matches.map(match => match.mediaId),
	)
	const explanations = new Map(
		result.matches.map(match => [match.mediaId, match]),
	)

	return json({
		ok: true as const,
		items: discovery.items.map(item => ({
			id: item.id,
			kind: item.kind,
			title: item.title,
			thumbnail: item.thumbnail,
			type: item.type,
			year: item.year,
			memoryMatch: explanations.get(item.id) ?? null,
		})),
	})
}
