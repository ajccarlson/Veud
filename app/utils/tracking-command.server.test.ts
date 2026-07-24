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
