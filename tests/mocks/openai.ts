import { HttpResponse, http, type HttpHandler } from 'msw'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function responseSchemaName(body: JsonRecord) {
	const text = body.text
	if (!isRecord(text)) return null
	const format = text.format
	if (!isRecord(format)) return null
	return typeof format.name === 'string' ? format.name : null
}

function structuredResponse(value: unknown) {
	return HttpResponse.json({
		output: [
			{
				type: 'message',
				content: [{ type: 'output_text', text: JSON.stringify(value) }],
			},
		],
		usage: { input_tokens: 24, output_tokens: 12 },
	})
}

function tipOfTongueSuggestions() {
	return Array.from({ length: 5 }, (_, index) => {
		const title = `Glass Station Memory ${index + 1}`
		return {
			title,
			alternateTitle: null,
			year: null,
			kind: 'movie',
			reason: `${title} matches the red light and abandoned glass station.`,
			matchedClues: ['red light', 'glass station'],
		}
	})
}

export const handlers: Array<HttpHandler> = [
	http.post('https://api.openai.com/v1/responses', async ({ request }) => {
		const body = await request.json().catch(() => null)
		if (!isRecord(body)) {
			return HttpResponse.json(
				{ error: { code: 'invalid_mock_request' } },
				{ status: 400 },
			)
		}

		const schemaName = responseSchemaName(body)
		if (
			schemaName === 'tip_of_tongue_media_suggestions' ||
			schemaName === 'image_tip_of_tongue_media_suggestions'
		) {
			return structuredResponse({ suggestions: tipOfTongueSuggestions() })
		}

		return HttpResponse.json(
			{ error: { code: `unhandled_mock_schema:${schemaName ?? 'unknown'}` } },
			{ status: 422 },
		)
	}),
	http.post('https://api.openai.com/v1/moderations', () =>
		HttpResponse.json({
			id: 'mock-moderation',
			model: 'omni-moderation-latest',
			results: [
				{
					flagged: false,
					categories: {},
					category_scores: {},
				},
			],
		}),
	),
]
