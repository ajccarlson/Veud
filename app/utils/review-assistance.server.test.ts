import { afterEach, expect, test, vi } from 'vitest'
import { resetAiGatewayStateForTests } from './ai-gateway.server.ts'
import { assistReviewDraft } from './review-assistance.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	resetAiGatewayStateForTests()
})

test('sends only the draft and operation and discards invented evidence', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const draft = 'I loved the quiet pacing, but the final paragraph felt rushed.'
	let outbound = ''
	const result = await assistReviewDraft(
		{ draft, operation: 'clarity', rateLimitKey: 'viewer:test' },
		{
			fetchImpl: vi.fn<typeof fetch>(async (_url, init) => {
				outbound = String(init?.body ?? '')
				return new Response(
					JSON.stringify({
						output: [
							{
								type: 'message',
								content: [
									{
										type: 'output_text',
										text: JSON.stringify({
											findings: [
												{
													category: 'clarity',
													original: 'final paragraph felt rushed',
													replacement: 'ending felt rushed',
													explanation: 'Tighter phrasing.',
													substantive: false,
												},
												{
													category: 'clarity',
													original: 'invented quote',
													replacement: 'bad',
													explanation: 'Unsupported.',
													substantive: false,
												},
											],
											proposedRevision:
												'I loved the quiet pacing, but the ending felt rushed.',
											spoilerLikelihood: 'low',
											spoilerReason: 'No plot event is named.',
										}),
									},
								],
							},
						],
					}),
					{ status: 200 },
				)
			}),
		},
	)
	expect(result.findings).toHaveLength(1)
	expect(outbound).toContain(draft)
	expect(outbound).not.toContain('mediaId')
	expect(outbound).not.toContain('catalog')
})
