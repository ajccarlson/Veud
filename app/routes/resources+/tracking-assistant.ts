import {
	data as json,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
} from 'react-router'
import { z } from 'zod'
import { isAiCapabilityConfigured } from '#app/utils/ai-gateway.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	applyTrackingCommandPreview,
	createTrackingCommandPreview,
	getTrackingCommandPreviews,
	undoTrackingCommandPreview,
} from '#app/utils/tracking-command.server.ts'

const ActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('preview'),
		command: z.string().trim().min(3).max(800),
	}),
	z.object({
		intent: z.literal('apply'),
		previewId: z.string().min(1).max(100),
	}),
	z.object({
		intent: z.literal('undo'),
		previewId: z.string().min(1).max(100),
	}),
])

async function getAssistantState(ownerId: string) {
	return {
		previews: await getTrackingCommandPreviews(prisma, ownerId),
		enabled: isAiCapabilityConfigured('tracking-command'),
	}
}

export async function loader({ request }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request)
	return json({
		...(await getAssistantState(ownerId)),
		ok: null,
		intent: null,
		error: null,
		summary: null,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const parsed = ActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return json(
			{
				...(await getAssistantState(ownerId)),
				ok: false as const,
				intent: null,
				error: 'Invalid tracking assistant request.',
				summary: null,
			},
			{ status: 400 },
		)
	}

	try {
		if (parsed.data.intent === 'preview') {
			await createTrackingCommandPreview(prisma, {
				ownerId,
				requestText: parsed.data.command,
				rateLimitKey: `viewer:${ownerId}`,
			})
			return json({
				...(await getAssistantState(ownerId)),
				ok: true as const,
				intent: 'preview' as const,
				error: null,
				summary: null,
			})
		}

		if (parsed.data.intent === 'apply') {
			const result = await applyTrackingCommandPreview(prisma, {
				ownerId,
				previewId: parsed.data.previewId,
			})
			return json({
				...(await getAssistantState(ownerId)),
				ok: true as const,
				intent: 'apply' as const,
				error: null,
				summary: result.summary,
			})
		}

		const result = await undoTrackingCommandPreview(prisma, {
			ownerId,
			previewId: parsed.data.previewId,
		})
		return json({
			...(await getAssistantState(ownerId)),
			ok: true as const,
			intent: 'undo' as const,
			error: null,
			summary: result.summary,
		})
	} catch (error) {
		return json(
			{
				...(await getAssistantState(ownerId)),
				ok: false as const,
				intent: parsed.data.intent,
				error:
					error instanceof Response
						? await error.text()
						: error instanceof Error
							? error.message
							: 'The assistant could not prepare this change.',
				summary: null,
			},
			{ status: error instanceof Response ? error.status : 503 },
		)
	}
}
