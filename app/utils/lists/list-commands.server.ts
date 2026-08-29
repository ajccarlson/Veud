import {
	bulkDeleteEntriesCommand,
	bulkMoveEntriesCommand,
} from './bulk-list-commands.server.ts'
import { addEntryCommand } from './commands/add-entry.server.ts'
import { addFavoriteCommand } from './commands/add-favorite.server.ts'
import { advancedEditEntryCommand } from './commands/advanced-edit-entry.server.ts'
import { createWatchlistCommand } from './commands/create-watchlist.server.ts'
import { deleteEmptyEntriesCommand } from './commands/delete-empty-entries.server.ts'
import { deleteEntryCommand } from './commands/delete-entry.server.ts'
import { deleteWatchlistCommand } from './commands/delete-watchlist.server.ts'
import { moveEntryCommand } from './commands/move-entry.server.ts'
import { removeFavoriteCommand } from './commands/remove-favorite.server.ts'
import { reorderEntriesCommand } from './commands/reorder-entries.server.ts'
import { reorderFavoritesCommand } from './commands/reorder-favorites.server.ts'
import { touchWatchlistCommand } from './commands/touch-watchlist.server.ts'
import { updateEntryCellCommand } from './commands/update-entry-cell.server.ts'
import { updateEntryCommand } from './commands/update-entry.server.ts'
import { updateWatchlistSettingsCommand } from './commands/update-watchlist-settings.server.ts'
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
