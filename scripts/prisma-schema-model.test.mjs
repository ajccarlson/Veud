import { Prisma } from '@prisma/client'
import { expect, test } from 'vitest'
import {
	listRelations,
	schemaModel,
	schemaModels,
} from './prisma-schema-model.mjs'

/**
 * The parser has to agree with Prisma about the schema, or every guard built on
 * it is asserting against a fiction.
 *
 * This comparison is possible only while the generated DMMF still carries the
 * facts. Prisma 7 removes `isList`, `isRequired`, `isId`, `relationFromFields`
 * and `relationOnDelete` from it — which is why the guards were moved off the
 * DMMF in the first place. When that upgrade happens this test stops being able
 * to compare and should be replaced with fixtures, not deleted.
 */
test('the parsed schema matches what Prisma understands, field for field', () => {
	const parsed = new Map(schemaModels().map(model => [model.name, model]))
	const generated = Prisma.dmmf.datamodel.models

	expect(parsed.size).toBe(generated.length)

	const problems = []
	for (const model of generated) {
		const mine = parsed.get(model.name)
		if (!mine) {
			problems.push(`${model.name} is missing from the parse`)
			continue
		}
		const fields = new Map(mine.fields.map(field => [field.name, field]))
		for (const field of model.fields) {
			const parsedField = fields.get(field.name)
			if (!parsedField) {
				problems.push(`${model.name}.${field.name} is missing`)
				continue
			}
			// Enums are scalars for every purpose the guards care about.
			const kind = field.kind === 'enum' ? 'scalar' : field.kind
			const comparisons = [
				['kind', parsedField.kind, kind],
				['isList', parsedField.isList, field.isList],
				['isRequired', parsedField.isRequired, field.isRequired],
				['isId', parsedField.isId, Boolean(field.isId)],
				[
					'relationFromFields',
					JSON.stringify(parsedField.relationFromFields),
					JSON.stringify(field.relationFromFields ?? []),
				],
				[
					'relationOnDelete',
					parsedField.relationOnDelete,
					field.relationOnDelete ?? null,
				],
			]
			for (const [what, mineValue, theirs] of comparisons) {
				if (mineValue !== theirs) {
					problems.push(
						`${model.name}.${field.name} ${what}: parsed ${mineValue}, Prisma ${theirs}`,
					)
				}
			}
		}
		for (const name of fields.keys()) {
			if (!model.fields.some(field => field.name === name)) {
				problems.push(
					`${model.name}.${name} was parsed but Prisma has no such field`,
				)
			}
		}
	}

	expect(problems).toEqual([])
})

test('a model with no such name is an error, not an empty answer', () => {
	// Returning nothing would let a renamed model quietly empty out a guard.
	expect(() => schemaModel('NoSuchModel')).toThrow(/No model named NoSuchModel/)
})

test('list relations are the to-many ones and nothing else', () => {
	const media = listRelations('Media')
	expect(media).toContain('entries')
	expect(media).toContain('credits')
	// A to-one relation is not a list.
	expect(listRelations('User')).not.toContain('image')
	expect(listRelations('User')).toContain('watchlists')
})
