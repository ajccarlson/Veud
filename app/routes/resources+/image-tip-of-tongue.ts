import {
	FormDataParseError,
	MultipartParseError,
	parseFormData,
} from '@remix-run/form-data-parser'
import { data as json, type ActionFunctionArgs } from 'react-router'
import { z } from 'zod'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	getDiscoveryResultsForMediaIds,
	parseDiscoveryQuery,
} from '#app/utils/discovery.server.ts'
import {
	getImageTipOfTongueMatches,
	TipOfTongueImageError,
} from '#app/utils/tip-of-tongue.server.ts'

const FieldsSchema = z.object({
	prompt: z.string().trim().max(500).default(''),
	kind: z.enum(['all', 'movie', 'tv', 'anime', 'manga']),
})

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const contentLength = Number(request.headers.get('content-length') ?? '0')
	if (Number.isFinite(contentLength) && contentLength > 6.5 * 1024 * 1024) {
		return json(
			{ ok: false as const, error: 'Images must be 6 MB or smaller.' },
			{ status: 413 },
		)
	}
	let formData: FormData
	try {
		formData = await parseFormData(request, {
			maxFiles: 1,
			maxFileSize: 6 * 1024 * 1024,
			maxParts: 4,
			maxTotalSize: 6 * 1024 * 1024 + 64 * 1024,
		})
	} catch (error) {
		if (
			error instanceof FormDataParseError ||
			error instanceof MultipartParseError
		) {
			const exceededLimit = error.name.startsWith('Max')
			return json(
				{
					ok: false as const,
					error: exceededLimit
						? 'Images must be 6 MB or smaller.'
						: 'The image upload could not be read.',
				},
				{ status: exceededLimit ? 413 : 400 },
			)
		}
		throw error
	}
	const fields = FieldsSchema.safeParse({
		prompt: formData.get('prompt'),
		kind: formData.get('kind'),
	})
	const image = formData.get('image')
	if (!fields.success || !(image instanceof File)) {
		return json(
			{ ok: false as const, error: 'Choose a valid image and media type.' },
			{ status: 400 },
		)
	}
	try {
		const result = await getImageTipOfTongueMatches(
			{ image, ...fields.data },
			{ rateLimitKey: `viewer:${ownerId}` },
		)
		const filters = parseDiscoveryQuery(
			new URLSearchParams({ kind: fields.data.kind, mode: 'memory' }),
		)
		const discovery = await getDiscoveryResultsForMediaIds(
			filters,
			ownerId,
			result.matches.map(match => match.mediaId),
		)
		const explanations = new Map(
			result.matches.map(match => [match.mediaId, match]),
		)
		return json({
			ok: true as const,
			items: discovery.items.map(item => ({
				...item,
				memoryMatch: explanations.get(item.id) ?? null,
			})),
			upload: result.upload,
		})
	} catch (error) {
		const status = error instanceof TipOfTongueImageError ? error.status : 503
		return json(
			{
				ok: false as const,
				error:
					error instanceof TipOfTongueImageError
						? error.message
						: 'Image identification is temporarily unavailable.',
			},
			{ status },
		)
	}
}
