import { type Prisma, type PrismaClient } from '@prisma/client'
import { afterEach, expect, test, vi } from 'vitest'
import { resetAiGatewayStateForTests } from './ai-gateway.server.ts'
import { prisma } from './db.server.ts'
import {
	applyTrackingCommandPreview,
	createTrackingCommandPreview,
	undoTrackingCommandPreview,
} from './tracking-command.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	resetAiGatewayStateForTests()
})

function aiResponse(output: unknown) {
	return new Response(
		JSON.stringify({
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: JSON.stringify(output) }],
				},
			],
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	)
}

type TransactionCallback = (tx: Prisma.TransactionClient) => Promise<unknown>

function transactionConflict() {
	return Object.assign(new Error('serialization conflict'), { code: 'P2034' })
}

function createTransactionHarness(commitErrors: readonly unknown[]) {
	const attempts: string[][] = []
	const options: Array<{ isolationLevel?: string } | undefined> = []
	let createTransactionClient!: () => Prisma.TransactionClient
	let activeAttempt: string[] | undefined
	const transaction = vi.fn(
		async (
			callback: TransactionCallback,
			transactionOptions?: { isolationLevel?: string },
		) => {
			activeAttempt = []
			attempts.push(activeAttempt)
			options.push(transactionOptions)
			const result = await callback(createTransactionClient())
			const error = commitErrors[attempts.length - 1]
			if (error !== undefined) throw error
			return result
		},
	)

	return {
		client: { $transaction: transaction } as unknown as PrismaClient,
		attempts,
		options,
		record(operation: string) {
			if (!activeAttempt) {
				throw new Error('Transaction operation recorded outside an attempt.')
			}
			activeAttempt.push(operation)
		},
		useTransactionClientFactory(value: () => Prisma.TransactionClient) {
			createTransactionClient = value
		},
	}
}

function appliedPreviewTransaction(
	record: (operation: string) => void,
	summary = 'Already applied.',
) {
	return {
		$executeRaw: vi.fn(async () => {
			record('mutex')
			return 1
		}),
		trackingCommandPreview: {
			findFirst: vi.fn(async () => {
				record('preview')
				return {
					status: 'applied',
					operations: JSON.stringify({ summary, operations: [] }),
				}
			}),
		},
	} as unknown as Prisma.TransactionClient
}

test('apply retries a P2034 transaction with the owner mutex first each time', async () => {
	const conflict = transactionConflict()
	const harness = createTransactionHarness([conflict])
	harness.useTransactionClientFactory(() =>
		appliedPreviewTransaction(operation => harness.record(operation)),
	)

	await expect(
		applyTrackingCommandPreview(harness.client, {
			ownerId: 'retry-owner',
			previewId: 'retry-preview',
		}),
	).resolves.toEqual({
		summary: 'Already applied.',
		operations: [],
		alreadyApplied: true,
	})
	expect(harness.attempts).toEqual([
		['mutex', 'preview'],
		['mutex', 'preview'],
	])
	expect(harness.options).toEqual([
		{ isolationLevel: 'Serializable' },
		{ isolationLevel: 'Serializable' },
	])
})

test('undo retries the complete Serializable transaction after P2034', async () => {
	const now = new Date('2026-07-29T08:00:00.000Z')
	const conflict = transactionConflict()
	const harness = createTransactionHarness([conflict])
	const record = (operation: string) => harness.record(operation)
	const snapshot = {
		operations: [],
		states: [],
		favorites: [],
		collectionItems: [],
		entries: [],
	}
	harness.useTransactionClientFactory(
		() =>
			({
				$executeRaw: vi.fn(async () => {
					record('mutex')
					return 1
				}),
				trackingCommandPreview: {
					findFirst: vi.fn(async () => {
						record('preview')
						return {
							id: 'undo-preview',
							journal: JSON.stringify({ before: snapshot, after: snapshot }),
							appliedAt: now,
							operations: JSON.stringify({
								summary: 'Undo applied command.',
								operations: [],
							}),
						}
					}),
					update: vi.fn(async () => ({ id: 'undo-preview' })),
				},
				trackingState: { findMany: vi.fn(async () => []) },
				userFavorite: {
					findMany: vi.fn(async () => []),
					deleteMany: vi.fn(async () => ({ count: 0 })),
				},
				mediaCollectionItem: { findMany: vi.fn(async () => []) },
				entry: {
					findMany: vi.fn(async () => []),
					deleteMany: vi.fn(async () => ({ count: 0 })),
				},
			}) as unknown as Prisma.TransactionClient,
	)

	await expect(
		undoTrackingCommandPreview(harness.client, {
			ownerId: 'retry-owner',
			previewId: 'undo-preview',
			now,
		}),
	).resolves.toEqual({ summary: 'Undo applied command.' })
	expect(harness.attempts).toHaveLength(2)
	expect(harness.attempts.map(attempt => attempt.slice(0, 2))).toEqual([
		['mutex', 'preview'],
		['mutex', 'preview'],
	])
	expect(harness.options).toEqual([
		{ isolationLevel: 'Serializable' },
		{ isolationLevel: 'Serializable' },
	])
})

test('Serializable retries stop after three P2034 attempts', async () => {
	const conflict = transactionConflict()
	const harness = createTransactionHarness([conflict, conflict, conflict])
	harness.useTransactionClientFactory(() =>
		appliedPreviewTransaction(operation => harness.record(operation)),
	)

	await expect(
		applyTrackingCommandPreview(harness.client, {
			ownerId: 'bounded-owner',
			previewId: 'bounded-preview',
		}),
	).rejects.toBe(conflict)
	expect(harness.attempts).toHaveLength(3)
	expect(harness.attempts.every(attempt => attempt[0] === 'mutex')).toBe(true)
})

test('Serializable transactions do not retry non-P2034 failures', async () => {
	const failure = new Error('domain failure')
	const harness = createTransactionHarness([failure])
	harness.useTransactionClientFactory(() =>
		appliedPreviewTransaction(operation => harness.record(operation)),
	)

	await expect(
		applyTrackingCommandPreview(harness.client, {
			ownerId: 'single-owner',
			previewId: 'single-preview',
		}),
	).rejects.toBe(failure)
	expect(harness.attempts).toEqual([['mutex', 'preview']])
})

test('builds a local preview and requires explicit application', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: { email: 'command@example.com', username: 'command_member' },
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
		update: {},
	})
	const watching = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Command Clock' },
	})
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as { input: string }
		expect(JSON.parse(body.input)).toEqual({
			memberCommand: 'Put Command Clock in Watching at episode 3 and score 9',
		})
		expect(body.input).not.toContain(media.id)
		return aiResponse({
			summary: 'Track Command Clock.',
			operations: [
				{
					title: 'Command Clock',
					kind: 'anime',
					destination: 'Watching',
					score: 9,
					progressUnit: 'episode',
					progressCurrent: 3,
					favorite: null,
					collection: null,
				},
			],
		})
	})
	const preview = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Put Command Clock in Watching at episode 3 and score 9',
		rateLimitKey: owner.id,
		fetchImpl,
	})
	expect(await prisma.trackingState.count()).toBe(0)
	const applied = await applyTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		previewId: preview.id,
	})
	expect(applied.alreadyApplied).toBe(false)
	expect(
		await prisma.trackingState.findUniqueOrThrow({
			where: { ownerId_mediaId: { ownerId: owner.id, mediaId: media.id } },
			include: { progress: true },
		}),
	).toEqual(
		expect.objectContaining({
			statusWatchlistId: watching.id,
			score: expect.objectContaining({}),
			progress: [expect.objectContaining({ unit: 'episode', current: 3 })],
		}),
	)
	const activityCount = await prisma.activityEvent.count({
		where: { actorId: owner.id, mediaId: media.id },
	})
	expect(activityCount).toBeGreaterThan(0)
	await expect(
		applyTrackingCommandPreview(prisma, {
			ownerId: owner.id,
			previewId: preview.id,
		}),
	).resolves.toEqual(expect.objectContaining({ alreadyApplied: true }))
	expect(
		await prisma.activityEvent.count({
			where: { actorId: owner.id, mediaId: media.id },
		}),
	).toBe(activityCount)
	const other = await prisma.user.create({
		data: {
			email: 'command-other@example.com',
			username: 'command_other',
		},
	})
	await expect(
		applyTrackingCommandPreview(prisma, {
			ownerId: other.id,
			previewId: preview.id,
		}),
	).rejects.toMatchObject({ status: 409 })
	await undoTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		previewId: preview.id,
	})
	expect(
		await prisma.trackingState.findUnique({
			where: { ownerId_mediaId: { ownerId: owner.id, mediaId: media.id } },
		}),
	).toBeNull()
	expect(
		await prisma.entry.count({
			where: { mediaId: media.id, watchlist: { ownerId: owner.id } },
		}),
	).toBe(0)
})

test('prefers a mixed-case exact title over more-popular partial matches', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: {
			email: 'case-command@example.com',
			username: 'case_command',
		},
	})
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'The MiXeD CaSe Command Clock',
			catalogPopularity: 1,
		},
	})
	await prisma.media.createMany({
		data: Array.from({ length: 20 }, (_, index) => ({
			kind: 'movie',
			title: `THE MIXED CASE COMMAND CLOCK ${index + 1} THE MIXED CASE COMMAND CLOCK`,
			catalogPopularity: 1_000 - index,
		})),
	})
	const preview = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Favorite mixed case command clock',
		rateLimitKey: owner.id,
		fetchImpl: vi.fn<typeof fetch>(async () =>
			aiResponse({
				summary: 'Favorite one title.',
				operations: [
					{
						title: 'tHe mIxEd CaSe CoMmAnD cLoCk',
						kind: 'movie',
						destination: null,
						score: null,
						progressUnit: null,
						progressCurrent: null,
						favorite: true,
						collection: null,
					},
				],
			}),
		),
	})
	const stored = JSON.parse(preview.operations) as {
		operations: Array<{ mediaId: string }>
	}
	expect(stored.operations.map(operation => operation.mediaId)).toEqual([
		media.id,
	])
})

test('still resolves a unique mixed-case partial catalog title', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: {
			email: 'partial-command@example.com',
			username: 'partial_command',
		},
	})
	const media = await prisma.media.create({
		data: {
			kind: 'movie',
			title: 'The Partial Command Clock',
		},
	})
	const preview = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Favorite Partial Command Clock',
		rateLimitKey: owner.id,
		fetchImpl: vi.fn<typeof fetch>(async () =>
			aiResponse({
				summary: 'Favorite one title.',
				operations: [
					{
						title: 'pArTiAl cOmMaNd cLoCk',
						kind: 'movie',
						destination: null,
						score: null,
						progressUnit: null,
						progressCurrent: null,
						favorite: true,
						collection: null,
					},
				],
			}),
		),
	})
	const stored = JSON.parse(preview.operations) as {
		operations: Array<{ mediaId: string }>
	}
	expect(stored.operations.map(operation => operation.mediaId)).toEqual([
		media.id,
	])
})

test('keeps duplicate normalized canonical titles ambiguous', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: {
			email: 'ambiguous-command@example.com',
			username: 'ambiguous_command',
		},
	})
	await prisma.media.createMany({
		data: [
			{ kind: 'movie', title: 'Twin Case Clock' },
			{ kind: 'movie', title: 'tWIN cASE cLOCK' },
		],
	})

	const error = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Favorite Twin Case Clock',
		rateLimitKey: owner.id,
		fetchImpl: vi.fn<typeof fetch>(async () =>
			aiResponse({
				summary: 'Favorite one title.',
				operations: [
					{
						title: 'TWIN CASE CLOCK',
						kind: 'movie',
						destination: null,
						score: null,
						progressUnit: null,
						progressCurrent: null,
						favorite: true,
						collection: null,
					},
				],
			}),
		),
	}).catch(caught => caught)
	expect(error).toBeInstanceOf(Response)
	expect((error as Response).status).toBe(409)
	expect(await (error as Response).text()).toContain('is ambiguous')
})

test('treats SQL wildcard characters literally in canonical exact titles', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: {
			email: 'literal-command@example.com',
			username: 'literal_command',
		},
	})
	const exact = await prisma.media.create({
		data: { kind: 'movie', title: 'One 100%_Case Clock' },
	})
	await prisma.media.create({
		data: { kind: 'movie', title: 'One 100XXCase Clock' },
	})

	const preview = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Favorite the literal title',
		rateLimitKey: owner.id,
		fetchImpl: vi.fn<typeof fetch>(async () =>
			aiResponse({
				summary: 'Favorite one title.',
				operations: [
					{
						title: 'oNe 100%_cAsE cLoCk',
						kind: 'movie',
						destination: null,
						score: null,
						progressUnit: null,
						progressCurrent: null,
						favorite: true,
						collection: null,
					},
				],
			}),
		),
	})
	const stored = JSON.parse(preview.operations) as {
		operations: Array<{ mediaId: string; mediaTitle: string }>
	}
	expect(stored.operations).toEqual([
		expect.objectContaining({ mediaId: exact.id, mediaTitle: exact.title }),
	])
})

test('undo restores exact source and destination list positions after a move', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: {
			email: 'move-command@example.com',
			username: 'move_command',
		},
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
		update: {},
	})
	const [watching, completed] = await Promise.all([
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'watching',
				header: 'Watching',
				position: 1,
			},
		}),
		prisma.watchlist.create({
			data: {
				ownerId: owner.id,
				typeId: listType.id,
				name: 'completed',
				header: 'Completed',
				position: 2,
			},
		}),
	])
	const [movedMedia, sourceNeighbor, destinationNeighbor] = await Promise.all([
		prisma.media.create({
			data: { kind: 'anime', title: 'Movable Command Title' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Source Neighbor' },
		}),
		prisma.media.create({
			data: { kind: 'anime', title: 'Destination Neighbor' },
		}),
	])
	const state = await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: movedMedia.id,
			status: 'watching',
			statusWatchlistId: watching.id,
		},
	})
	await prisma.entry.createMany({
		data: [
			{
				watchlistId: watching.id,
				mediaId: movedMedia.id,
				trackingStateId: state.id,
				title: movedMedia.title!,
				position: 1,
			},
			{
				watchlistId: watching.id,
				mediaId: sourceNeighbor.id,
				title: sourceNeighbor.title!,
				position: 2,
			},
			{
				watchlistId: completed.id,
				mediaId: destinationNeighbor.id,
				title: destinationNeighbor.title!,
				position: 1,
			},
		],
	})
	const preview = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Move Movable Command Title to Completed',
		rateLimitKey: owner.id,
		fetchImpl: vi.fn<typeof fetch>(async () =>
			aiResponse({
				summary: 'Move one title.',
				operations: [
					{
						title: 'Movable Command Title',
						kind: 'anime',
						destination: 'Completed',
						score: null,
						progressUnit: null,
						progressCurrent: null,
						favorite: null,
						collection: null,
					},
				],
			}),
		),
	})
	await applyTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		previewId: preview.id,
	})
	await undoTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		previewId: preview.id,
	})
	expect(
		await prisma.entry.findMany({
			where: { watchlist: { ownerId: owner.id } },
			orderBy: [{ watchlistId: 'asc' }, { position: 'asc' }],
			select: { mediaId: true, watchlistId: true, position: true },
		}),
	).toEqual(
		expect.arrayContaining([
			{
				mediaId: movedMedia.id,
				watchlistId: watching.id,
				position: 1,
			},
			{
				mediaId: sourceNeighbor.id,
				watchlistId: watching.id,
				position: 2,
			},
			{
				mediaId: destinationNeighbor.id,
				watchlistId: completed.id,
				position: 1,
			},
		]),
	)
})

test('rejects a stale preview after tracking state changes', async () => {
	vi.stubEnv('OPENAI_API_KEY', 'test-key')
	const owner = await prisma.user.create({
		data: { email: 'stale-command@example.com', username: 'stale_command' },
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '[]',
			completionType: '{}',
		},
		update: {},
	})
	const watching = await prisma.watchlist.create({
		data: {
			ownerId: owner.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: 'Stale Clock' },
	})
	const preview = await createTrackingCommandPreview(prisma, {
		ownerId: owner.id,
		requestText: 'Put Stale Clock in Watching',
		rateLimitKey: owner.id,
		fetchImpl: vi.fn<typeof fetch>(async () =>
			aiResponse({
				summary: 'Track Stale Clock.',
				operations: [
					{
						title: 'Stale Clock',
						kind: 'anime',
						destination: 'Watching',
						score: null,
						progressUnit: null,
						progressCurrent: null,
						favorite: null,
						collection: null,
					},
				],
			}),
		),
	})
	await prisma.trackingState.create({
		data: {
			ownerId: owner.id,
			mediaId: media.id,
			status: 'watching',
			statusWatchlistId: watching.id,
		},
	})
	await expect(
		applyTrackingCommandPreview(prisma, {
			ownerId: owner.id,
			previewId: preview.id,
		}),
	).rejects.toMatchObject({ status: 409 })
})
