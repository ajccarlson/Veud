import { expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import { reconcileLibraryImport } from './library-import-reconciliation.server.ts'
import { type LibraryImportItem } from './library-import.ts'

const baseItem = {
	sourceKey: 'mal:anime:77',
	provider: 'myanimelist',
	mediaKind: 'anime',
	title: 'Import fixture',
	externalId: '77',
	status: 'completed',
	score: 8,
	progress: { episodes: 12 },
	repeatCount: 1,
	startedAt: null,
	completedAt: null,
} satisfies LibraryImportItem

test('prefers provider IDs and identifies an existing tracking conflict', async () => {
	const owner = await prisma.user.create({
		data: { username: 'import_owner', email: 'import-owner@example.com' },
	})
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Canonical fixture',
			externalIds: {
				create: { provider: 'mal', kind: 'anime', externalId: '77' },
			},
		},
	})
	await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			status: 'current',
			score: 6,
		},
	})
	const [result] = await reconcileLibraryImport(prisma, owner.id, [baseItem])
	expect(result).toEqual(
		expect.objectContaining({
			match: expect.objectContaining({
				state: 'matched',
				mediaId: media.id,
				method: 'external-id',
			}),
			existing: expect.objectContaining({ status: 'current', score: 6 }),
		}),
	)
})

test('falls back to normalized exact titles and preserves ambiguity', async () => {
	await Promise.all(
		['first', 'second'].map(provider =>
			prisma.media.create({
				data: {
					kind: 'movie',
					title: `Shared title ${provider}`,
					titles: {
						create: {
							provider,
							titleType: 'primary',
							value: 'Amélie',
							normalized: 'amelie',
						},
					},
				},
			}),
		),
	)
	const [result] = await reconcileLibraryImport(prisma, 'owner', [
		{
			...baseItem,
			sourceKey: 'letterboxd:movie:amelie',
			provider: 'letterboxd',
			mediaKind: 'movie',
			title: 'Amélie',
			externalId: null,
		},
	])
	expect(result?.match).toEqual(
		expect.objectContaining({
			state: 'ambiguous',
			candidates: expect.any(Array),
		}),
	)
	if (result?.match.state === 'ambiguous') {
		expect(result.match.candidates).toHaveLength(2)
	}
})
