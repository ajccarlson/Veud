import {
	LIST_ENTRIES_MAX_PAGE_SIZE,
	ListEntriesPaginationSchema,
	ListMutationResponseSchema,
	type ListMutationInput,
	type ListMutationIntent,
} from './mutation-contracts.ts'

export class ListMutationClientError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
		readonly issues?: Array<{ path: string; message: string }>,
	) {
		super(message)
		this.name = 'ListMutationClientError'
	}
}

export async function mutateList<
	Intent extends ListMutationIntent,
	Result = unknown,
>(intent: Intent, input: ListMutationInput<Intent>): Promise<Result> {
	const response = await fetch('/resources/lists/v1', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ version: 1, intent, input }),
	})
	const parsed = ListMutationResponseSchema.safeParse(
		await response.json().catch(() => null),
	)
	if (!parsed.success) {
		throw new ListMutationClientError(
			`List request returned an invalid response (${response.status})`,
			response.status,
			'INVALID_RESPONSE',
		)
	}
	if (!parsed.data.ok) {
		throw new ListMutationClientError(
			parsed.data.error.message,
			response.status,
			parsed.data.error.code,
			parsed.data.error.issues,
		)
	}
	if (!response.ok) {
		throw new ListMutationClientError(
			`List request failed (${response.status})`,
			response.status,
			'REQUEST_FAILED',
		)
	}
	return parsed.data.data as Result
}

export async function getWatchlistEntries<Result = unknown[]>(
	watchlistId: string,
): Promise<Result> {
	async function collect(restartAvailable: boolean): Promise<unknown[]> {
		const entries: unknown[] = []
		const seenCursors = new Set<string>()
		let cursor: string | null = null
		let revision: number | null = null

		for (;;) {
			const query = new URLSearchParams({
				watchlistId,
				take: String(LIST_ENTRIES_MAX_PAGE_SIZE),
			})
			if (cursor) query.set('cursor', cursor)
			if (revision !== null) query.set('revision', String(revision))

			const response = await fetch(`/resources/lists/v1/entries?${query}`)
			const parsed = ListMutationResponseSchema.safeParse(
				await response.json().catch(() => null),
			)
			if (!parsed.success) {
				throw new ListMutationClientError(
					`Could not load list entries (${response.status})`,
					response.status,
					'INVALID_RESPONSE',
				)
			}
			if (!parsed.data.ok) {
				if (response.status === 409 && restartAvailable) {
					return collect(false)
				}
				throw new ListMutationClientError(
					parsed.data.error.message,
					response.status,
					parsed.data.error.code,
					parsed.data.error.issues,
				)
			}
			if (!response.ok) {
				throw new ListMutationClientError(
					`Could not load list entries (${response.status})`,
					response.status,
					'REQUEST_FAILED',
				)
			}

			const pagination = ListEntriesPaginationSchema.safeParse(
				parsed.data.pagination,
			)
			if (!pagination.success || !Array.isArray(parsed.data.data)) {
				throw new ListMutationClientError(
					`Could not load list entries (${response.status})`,
					response.status,
					'INVALID_RESPONSE',
				)
			}
			if (revision !== null && revision !== pagination.data.revision) {
				if (restartAvailable) return collect(false)
				throw new ListMutationClientError(
					'The list changed while it was loading',
					409,
					'CONFLICT',
				)
			}

			revision = pagination.data.revision
			entries.push(...parsed.data.data)
			cursor = pagination.data.nextCursor
			if (!cursor) return entries
			if (seenCursors.has(cursor)) {
				throw new ListMutationClientError(
					'List entries returned a repeated cursor',
					response.status,
					'INVALID_RESPONSE',
				)
			}
			seenCursors.add(cursor)
		}
	}

	return (await collect(true)) as Result
}
