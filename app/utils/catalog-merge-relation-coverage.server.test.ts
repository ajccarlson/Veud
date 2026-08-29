import { expect, test } from 'vitest'
import {
	listRelations,
	schemaModel,
} from '../../scripts/prisma-schema-model.mjs'
import {
	mediaMergeDrainCountSelect,
	mediaMergeRelationDispositions,
} from './catalog-media-merge.server.ts'

/**
 * Twice now a relation has been added to `Media` and left out of the merge:
 * streaming offers and cast were destroyed with the losing row until #278, and
 * the credit sync state until this change. Nothing failed, because every part
 * of the merge that lists relations lists them by hand.
 *
 * This is the tripwire. Adding a relation to the schema and not deciding what a
 * merge does with it now fails here, and because `assertSourceDrained` counts
 * every key in the ledger, deciding wrongly fails the merge at runtime instead
 * of losing the rows.
 */
test('every Media relation has a declared merge disposition', () => {
	const relations = listRelations('Media').sort()
	// A to-one relation would need a different disposition than "move the rows",
	// so the ledger deliberately only covers to-many. Catch one being added.
	expect(
		schemaModel('Media')
			.fields.filter(field => field.kind === 'object' && !field.isList)
			.map(field => field.name),
	).toEqual([])

	expect(relations).toEqual(Object.keys(mediaMergeRelationDispositions).sort())
})

test('the drain assertion counts every relation in the ledger', () => {
	// `assertSourceDrained` is the last thing standing between a relation nobody
	// moved and its rows being deleted with the source. It only works if it
	// counts all of them, and counting is invisible when it silently covers less
	// than the ledger does.
	expect(Object.keys(mediaMergeDrainCountSelect).sort()).toEqual(
		Object.keys(mediaMergeRelationDispositions).sort(),
	)
	expect(Object.values(mediaMergeDrainCountSelect)).not.toContain(false)
})
