import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { aiCapabilities } from './ai-gateway.server.ts'

const EvaluationSchema = z
	.object({
		version: z.literal(1),
		cases: z
			.array(
				z
					.object({
						id: z.string().regex(/^[a-z0-9-]+$/),
						capability: z.enum(aiCapabilities),
						dimensions: z.array(z.string().min(1)).min(1),
						input: z.record(z.string(), z.unknown()),
						expectations: z.array(z.string().min(1)).min(1),
					})
					.strict(),
			)
			.min(aiCapabilities.length),
	})
	.strict()

test('offline AI evaluation manifest covers every capability and release-risk dimension', () => {
	const manifest = EvaluationSchema.parse(
		JSON.parse(
			fs.readFileSync(
				path.join(process.cwd(), 'tests/fixtures/ai/offline-evaluation.json'),
				'utf8',
			),
		) as unknown,
	)
	expect(new Set(manifest.cases.map(item => item.id)).size).toBe(
		manifest.cases.length,
	)
	expect(new Set(manifest.cases.map(item => item.capability))).toEqual(
		new Set(aiCapabilities),
	)
	const dimensions = new Set(manifest.cases.flatMap(item => item.dimensions))
	for (const required of [
		'multilingual',
		'alternate-title',
		'media-kind-confusion',
		'ambiguity',
		'import-noise',
		'spoiler',
		'dialect-context',
		'refusal',
		'prompt-injection',
		'privacy',
	]) {
		expect(dimensions, `missing evaluation dimension ${required}`).toContain(
			required,
		)
	}
	const serializedInputs = JSON.stringify(
		manifest.cases.map(item => item.input),
	)
	for (const forbidden of [
		'mediaId',
		'ownerId',
		'accountId',
		'catalogPopularity',
		'catalogCandidates',
		'trackingHistory',
	]) {
		expect(serializedInputs).not.toContain(`"${forbidden}"`)
	}
})
