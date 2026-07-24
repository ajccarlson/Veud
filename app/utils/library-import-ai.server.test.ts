import { afterEach, expect, test, vi } from 'vitest'
import { resetAiGatewayStateForTests } from './ai-gateway.server.ts'
import { prisma } from './db.server.ts'
import { assistLibraryImportReconciliation } from './library-import-ai.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	resetAiGatewayStateForTests()
})

test('turns a user title hypothesis into reviewable local candidates only', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: { email: 'import-ai@example.com', username: 'import_ai' },
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Hypothesis Chronicle' },
	})
	const batch = await prisma.libraryImportBatch.create({
		data: {
			ownerId: owner.id,
			provider: 'myanimelist',
			fileName: 'list.xml',
			status: 'previewed',
			itemCount: 1,
			matchedCount: 0,
			ambiguousCount: 0,
			unmatchedCount: 1,
			conflictCount: 0,
			items: {
				create: {
					sourceKey: 'source-1',
					payload: JSON.stringify({
						sourceKey: 'source-1',
						provider: 'myanimelist',
						mediaKind: 'anime',
						title: '[Group] Hyp Chron S01 1080p',
						externalId: null,
						status: 'planning',
						score: null,
						progress: {},
						repeatCount: 0,
						startedAt: null,
						completedAt: null,
					}),
					matchState: 'unmatched',
				},
			},
		},
	})
	let outbound = ''
	await assistLibraryImportReconciliation(prisma, {
		ownerId: owner.id,
		batchId: batch.id,
		rateLimitKey: 'viewer:test',
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
										rows: [
											{
												itemKey: 'row-1',
												hypotheses: [
													{
														title: 'Hypothesis Chronicle',
														uncertainty: 'low',
													},
												],
											},
										],
									}),
								},
							],
						},
					],
				}),
				{ status: 200 },
			)
		}),
	})
	const item = await prisma.libraryImportItem.findFirstOrThrow({
		where: { batchId: batch.id },
	})
	expect(item.mediaId).toBeNull()
	expect(item.resolution).toBe('skip')
	expect(item.matchState).toBe('ambiguous')
	expect(JSON.parse(item.candidates)).toEqual([
		expect.objectContaining({ mediaId: media.id }),
	])
	expect(outbound).toContain('[Group] Hyp Chron S01 1080p')
	expect(outbound).not.toContain(media.id)
	expect(outbound).not.toContain('Hypothesis Chronicle')
})
