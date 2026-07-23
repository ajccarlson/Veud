import {
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
	const query = new URLSearchParams({ watchlistId })
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
	return parsed.data.data as Result
}
