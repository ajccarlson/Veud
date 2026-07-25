import { addFavoriteCommand } from '#app/routes/lists+/.fetch+/add-favorite.$request.ts'
import { addEntryCommand } from '#app/routes/lists+/.fetch+/add-row.$request.ts'
import { advancedEditEntryCommand } from '#app/routes/lists+/.fetch+/advanced-edit.$request.ts'
import { createWatchlistCommand } from '#app/routes/lists+/.fetch+/create-watchlist.$request.ts'
import { deleteEmptyEntriesCommand } from '#app/routes/lists+/.fetch+/delete-empty-rows.$request.ts'
import { deleteEntryCommand } from '#app/routes/lists+/.fetch+/delete-row.$request.ts'
import { deleteWatchlistCommand } from '#app/routes/lists+/.fetch+/delete-watchlist.$request.ts'
import { moveEntryCommand } from '#app/routes/lists+/.fetch+/move-row.$request.ts'
import { touchWatchlistCommand } from '#app/routes/lists+/.fetch+/now-updated.$request.ts'
import { removeFavoriteCommand } from '#app/routes/lists+/.fetch+/remove-favorite.$request.ts'
import { reorderFavoritesCommand } from '#app/routes/lists+/.fetch+/reorder-favorite.$request.ts'
import { reorderEntriesCommand } from '#app/routes/lists+/.fetch+/reorder-rows.$request.ts'
import { updateEntryCellCommand } from '#app/routes/lists+/.fetch+/update-cell.$request.ts'
import { updateEntryCommand } from '#app/routes/lists+/.fetch+/update-row.$request.ts'
import { updateWatchlistSettingsCommand } from '#app/routes/lists+/.fetch+/update-settings.$request.ts'
import {
	bulkDeleteEntriesCommand,
	bulkMoveEntriesCommand,
} from './bulk-list-commands.server.ts'
import { type ListMutationRequest } from './mutation-contracts.ts'

/**
 * The single authenticated write boundary for watchlists.
 *
 * Transport routes authenticate once and pass the stable owner id here. Commands
 * never inspect cookies, URL parameters, or request bodies, which keeps ownership
 * checks and domain mutations independent from React Router.
 */
export async function executeListCommand(
	ownerId: string,
	command: ListMutationRequest,
) {
	switch (command.intent) {
		case 'add-entry':
			return addEntryCommand(ownerId, command.input.row)
		case 'move-entry':
			return moveEntryCommand(ownerId, {
				entryId: command.input.entryId,
				destinationWatchlistId: command.input.destinationWatchlistId,
				position: command.input.position ?? null,
			})
		case 'reorder-entries':
			return reorderEntriesCommand(ownerId, command.input)
		case 'update-entry-cell':
			return updateEntryCellCommand(ownerId, {
				entryId: command.input.entryId,
				columnId: command.input.columnId,
				value: command.input.value,
			})
		case 'update-entry':
			return updateEntryCommand(
				ownerId,
				command.input.entryId,
				command.input.row,
			)
		case 'advanced-edit-entry':
			return advancedEditEntryCommand(
				ownerId,
				command.input.entryId,
				command.input.fields,
			)
		case 'delete-entry':
			return deleteEntryCommand(ownerId, command.input.entryId)
		case 'bulk-delete-entries':
			return bulkDeleteEntriesCommand(ownerId, command.input.entryIds)
		case 'bulk-move-entries':
			return bulkMoveEntriesCommand(
				ownerId,
				command.input.entryIds,
				command.input.destinationWatchlistId,
			)
		case 'touch-watchlist':
			return touchWatchlistCommand(ownerId, command.input.watchlistId)
		case 'create-watchlist':
			return createWatchlistCommand(ownerId, command.input)
		case 'update-watchlist-settings':
			return updateWatchlistSettingsCommand(
				ownerId,
				command.input.watchlistId,
				command.input.settings,
			)
		case 'delete-watchlist':
			return deleteWatchlistCommand(ownerId, command.input.watchlistId)
		case 'delete-empty-entries':
			return deleteEmptyEntriesCommand(ownerId, command.input.watchlistId)
		case 'add-favorite':
			return addFavoriteCommand(ownerId, command.input.favorite)
		case 'remove-favorite':
			return removeFavoriteCommand(ownerId, command.input.favoriteId)
		case 'reorder-favorites':
			return reorderFavoritesCommand(ownerId, command.input.order)
	}
}
