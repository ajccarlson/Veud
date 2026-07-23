import { data as json, type ActionFunctionArgs } from 'react-router'
import { action as addFavorite } from '#app/routes/lists+/.fetch+/add-favorite.$request.ts'
import { action as addEntry } from '#app/routes/lists+/.fetch+/add-row.$request.ts'
import { action as advancedEditEntry } from '#app/routes/lists+/.fetch+/advanced-edit.$request.ts'
import { action as createWatchlist } from '#app/routes/lists+/.fetch+/create-watchlist.$request.ts'
import { action as deleteEmptyEntries } from '#app/routes/lists+/.fetch+/delete-empty-rows.$request.ts'
import { action as deleteEntry } from '#app/routes/lists+/.fetch+/delete-row.$request.ts'
import { action as deleteWatchlist } from '#app/routes/lists+/.fetch+/delete-watchlist.$request.ts'
import { action as moveEntry } from '#app/routes/lists+/.fetch+/move-row.$request.ts'
import { action as touchWatchlist } from '#app/routes/lists+/.fetch+/now-updated.$request.ts'
import { action as removeFavorite } from '#app/routes/lists+/.fetch+/remove-favorite.$request.ts'
import { action as reorderFavorites } from '#app/routes/lists+/.fetch+/reorder-favorite.$request.ts'
import { action as reorderEntries } from '#app/routes/lists+/.fetch+/reorder-rows.$request.ts'
import { action as updateEntryCell } from '#app/routes/lists+/.fetch+/update-cell.$request.ts'
import { action as updateEntry } from '#app/routes/lists+/.fetch+/update-row.$request.ts'
import { action as updateWatchlistSettings } from '#app/routes/lists+/.fetch+/update-settings.$request.ts'
import { ListMutationRequestSchema } from '#app/utils/lists/mutation-contracts.ts'

type LegacyAction = (args: ActionFunctionArgs) => Promise<unknown>

function errorCode(status: number) {
	if (status === 400 || status === 422) return 'VALIDATION_FAILED' as const
	if (status === 401 || (status >= 300 && status < 400)) {
		return 'UNAUTHENTICATED' as const
	}
	if (status === 403) return 'FORBIDDEN' as const
	if (status === 404) return 'NOT_FOUND' as const
	if (status === 409) return 'CONFLICT' as const
	return 'INTERNAL_ERROR' as const
}

function legacyParams(values: Record<string, string | undefined>) {
	return new URLSearchParams(
		Object.entries(values).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	).toString()
}

function legacyRequest(
	request: Request,
	body?: Record<string, unknown>,
): Request {
	if (!body) return request
	const headers = new Headers(request.headers)
	headers.delete('content-length')
	return new Request(request.url, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	})
}

async function runLegacyAction(
	action: LegacyAction,
	request: Request,
	context: ActionFunctionArgs['context'],
	params: string,
	body?: Record<string, unknown>,
) {
	return action({
		request: legacyRequest(request, body),
		context,
		params: { request: params },
	} as unknown as ActionFunctionArgs)
}

export async function action({ request, context }: ActionFunctionArgs) {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'List mutations require application/json',
				},
			},
			{ status: 415 },
		)
	}

	const declaredLength = Number(request.headers.get('content-length') ?? 0)
	if (declaredLength > 1_000_000) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'List mutation payload is too large',
				},
			},
			{ status: 413 },
		)
	}
	const rawBody = await request.text()
	if (rawBody.length > 1_000_000) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'List mutation payload is too large',
				},
			},
			{ status: 413 },
		)
	}
	const rawPayload = (() => {
		try {
			return JSON.parse(rawBody) as unknown
		} catch {
			return null
		}
	})()
	const parsed = ListMutationRequestSchema.safeParse(rawPayload)
	if (!parsed.success) {
		return json(
			{
				ok: false as const,
				error: {
					code: 'INVALID_REQUEST' as const,
					message: 'Invalid list mutation request',
					issues: parsed.error.issues.map(issue => ({
						path: issue.path.join('.'),
						message: issue.message,
					})),
				},
			},
			{ status: 400 },
		)
	}

	const { intent, input } = parsed.data
	try {
		let result: unknown
		switch (intent) {
			case 'add-entry':
				result = await runLegacyAction(
					addEntry,
					request,
					context,
					legacyParams({ row: JSON.stringify(input.row) }),
				)
				break
			case 'move-entry':
				result = await runLegacyAction(
					moveEntry,
					request,
					context,
					legacyParams({
						entryId: input.entryId,
						destinationWatchlistId: input.destinationWatchlistId,
						position:
							input.position === undefined ? undefined : String(input.position),
					}),
				)
				break
			case 'reorder-entries':
				result = await runLegacyAction(
					reorderEntries,
					request,
					context,
					legacyParams({
						watchlistId: input.watchlistId,
						entryIds: JSON.stringify(input.entryIds),
					}),
				)
				break
			case 'update-entry-cell':
				result = await runLegacyAction(
					updateEntryCell,
					request,
					context,
					legacyParams({
						rowIndex: input.entryId,
						colId: input.columnId,
						newValue: input.value === null ? 'null' : String(input.value),
					}),
				)
				break
			case 'update-entry':
				result = await runLegacyAction(
					updateEntry,
					request,
					context,
					legacyParams({
						rowIndex: input.entryId,
						row: JSON.stringify(input.row),
					}),
				)
				break
			case 'advanced-edit-entry':
				result = await runLegacyAction(
					advancedEditEntry,
					request,
					context,
					'',
					{ entryId: input.entryId, fields: input.fields },
				)
				break
			case 'delete-entry':
				result = await runLegacyAction(
					deleteEntry,
					request,
					context,
					legacyParams({ id: input.entryId }),
				)
				break
			case 'touch-watchlist':
				result = await runLegacyAction(
					touchWatchlist,
					request,
					context,
					legacyParams({ watchlistId: input.watchlistId }),
				)
				break
			case 'create-watchlist': {
				const now = Date.now()
				const list = {
					position: { value: input.position, type: 'int' },
					name: { value: input.name, type: 'string' },
					header: { value: input.header, type: 'string' },
					typeId: { value: input.typeId, type: 'string' },
					displayedColumns: {
						value: input.displayedColumns,
						type: 'string',
					},
					createdAt: { value: now, type: 'date' },
					updatedAt: { value: now, type: 'date' },
					description: { value: input.description, type: 'string' },
				}
				result = await runLegacyAction(
					createWatchlist,
					request,
					context,
					legacyParams({ list: JSON.stringify(list) }),
				)
				break
			}
			case 'update-watchlist-settings':
				result = await runLegacyAction(
					updateWatchlistSettings,
					request,
					context,
					legacyParams({
						listId: input.watchlistId,
						settings: JSON.stringify(Object.entries(input.settings)),
					}),
				)
				break
			case 'delete-watchlist':
				result = await runLegacyAction(
					deleteWatchlist,
					request,
					context,
					legacyParams({ id: input.watchlistId }),
				)
				break
			case 'delete-empty-entries':
				result = await runLegacyAction(
					deleteEmptyEntries,
					request,
					context,
					legacyParams({ watchlistId: input.watchlistId }),
				)
				break
			case 'add-favorite':
				result = await runLegacyAction(
					addFavorite,
					request,
					context,
					legacyParams({ favorite: JSON.stringify(input.favorite) }),
				)
				break
			case 'remove-favorite':
				result = await runLegacyAction(
					removeFavorite,
					request,
					context,
					legacyParams({ id: input.favoriteId }),
				)
				break
			case 'reorder-favorites':
				result = await runLegacyAction(
					reorderFavorites,
					request,
					context,
					legacyParams({ order: JSON.stringify(input.order) }),
				)
				break
		}
		return json({ ok: true as const, data: result })
	} catch (error) {
		if (error instanceof Response) {
			const sourceStatus = error.status || 500
			const status =
				sourceStatus >= 300 && sourceStatus < 400 ? 401 : sourceStatus
			const message =
				(await error.text().catch(() => '')) || 'List request failed'
			return json(
				{
					ok: false as const,
					error: { code: errorCode(status), message },
				},
				{ status },
			)
		}
		console.error('[lists:v1] unexpected mutation error', error)
		return json(
			{
				ok: false as const,
				error: {
					code: 'INTERNAL_ERROR' as const,
					message: 'List request failed',
				},
			},
			{ status: 500 },
		)
	}
}
