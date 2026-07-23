import { z } from 'zod'

const id = z.string().trim().min(1).max(100)
const record = z.record(z.unknown())
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const ListMutationRequestSchema = z.discriminatedUnion('intent', [
	z.object({
		version: z.literal(1),
		intent: z.literal('add-entry'),
		input: z.object({ row: record }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('move-entry'),
		input: z.object({
			entryId: id,
			destinationWatchlistId: id,
			position: z.number().int().positive().optional(),
		}),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('reorder-entries'),
		input: z.object({
			watchlistId: id,
			entryIds: z.array(id).max(10_000),
		}),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('update-entry-cell'),
		input: z.object({
			entryId: id,
			columnId: z.string().trim().min(1).max(100),
			value: scalar,
		}),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('update-entry'),
		input: z.object({ entryId: id, row: record }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('advanced-edit-entry'),
		input: z.object({ entryId: id, fields: record }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('delete-entry'),
		input: z.object({ entryId: id }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('touch-watchlist'),
		input: z.object({ watchlistId: id }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('create-watchlist'),
		input: z.object({
			typeId: id,
			position: z.number().int().positive(),
			name: z.string().max(100),
			header: z.string().max(100),
			displayedColumns: z.string().min(1).max(5_000),
			description: z.string().max(5_000).default(''),
		}),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('update-watchlist-settings'),
		input: z.object({ watchlistId: id, settings: record }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('delete-watchlist'),
		input: z.object({ watchlistId: id }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('delete-empty-entries'),
		input: z.object({ watchlistId: id }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('add-favorite'),
		input: z.object({ favorite: record }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('remove-favorite'),
		input: z.object({ favoriteId: id }),
	}),
	z.object({
		version: z.literal(1),
		intent: z.literal('reorder-favorites'),
		input: z.object({
			order: z
				.array(z.object({ id, position: z.number().int().positive() }))
				.max(1_000),
		}),
	}),
])

export const ListMutationErrorSchema = z.object({
	code: z.enum([
		'INVALID_REQUEST',
		'UNAUTHENTICATED',
		'FORBIDDEN',
		'NOT_FOUND',
		'CONFLICT',
		'VALIDATION_FAILED',
		'INTERNAL_ERROR',
	]),
	message: z.string(),
	issues: z
		.array(
			z.object({
				path: z.string(),
				message: z.string(),
			}),
		)
		.optional(),
})

export const ListMutationResponseSchema = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), data: z.unknown() }),
	z.object({ ok: z.literal(false), error: ListMutationErrorSchema }),
])

export const ListEntriesQuerySchema = z.object({
	watchlistId: id,
})

export type ListMutationRequest = z.infer<typeof ListMutationRequestSchema>
export type ListMutationIntent = ListMutationRequest['intent']
export type ListMutationInput<Intent extends ListMutationIntent> = Extract<
	ListMutationRequest,
	{ intent: Intent }
>['input']
export type ListMutationError = z.infer<typeof ListMutationErrorSchema>
