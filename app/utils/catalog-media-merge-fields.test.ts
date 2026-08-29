import { expect, test } from 'vitest'
import { schemaModel } from '../../scripts/prisma-schema-model.mjs'
import { catalogMediaFields } from './catalog-media-merge.ts'

/**
 * Columns the merge deliberately does not reconcile, each for a stated reason.
 * Anything else on Media has to be in `catalogMediaFields`, or a merge silently
 * drops it and the reversal journal cannot put it back.
 */
const notReconciled: Record<string, string> = {
	id: 'identity',
	kind: 'decided by the merge itself, not filled from a row',
	catalogProvenanceVersion: 'provenance, not catalog content',
	createdAt: 'row lifecycle',
	updatedAt: 'row lifecycle',
	nextReleaseAt:
		'derived from nextRelease by deriveNextReleaseAt and written alongside it',
}

test('every catalog column on Media is reconciled or explicitly exempt', () => {
	// englishTitle was added to the schema and not to the merge, so merging a row
	// that had one into a row that did not lost it, with no journal entry to
	// restore. Nothing compared the list to the schema until this test.
	const scalars = schemaModel('Media')
		.fields.filter(field => field.kind === 'scalar')
		.map(field => field.name)

	const listed = new Set<string>(catalogMediaFields)
	const unaccounted = scalars.filter(
		name => !listed.has(name) && !(name in notReconciled),
	)
	expect(unaccounted).toEqual([])

	// And the exemptions have to still exist, so a renamed column does not leave
	// a stale excuse behind.
	expect(
		Object.keys(notReconciled).filter(name => !scalars.includes(name)),
	).toEqual([])
	// Nothing is both reconciled and exempt.
	expect(catalogMediaFields.filter(name => name in notReconciled)).toEqual([])
})

test('the English title is reconciled', () => {
	expect(catalogMediaFields).toContain('englishTitle')
})
