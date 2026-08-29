import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

/**
 * The schema, read from the schema.
 *
 * Several guards in this repository are assertions about the data model: which
 * relations a merge must carry, which a data export may not, which protect a
 * fixture from deletion, what survives an account delete. They were all reading
 * `Prisma.dmmf`, and Prisma 7 removes almost everything they use — a relation
 * field there carries only `name`, `kind`, `type` and `relationName`, with no
 * `isList`, `isRequired`, `relationFromFields` or `relationOnDelete`.
 *
 * Those are facts about `schema.prisma`, not about the generated client, so
 * they are read from the file instead. It is checked in, it is the source the
 * client is generated from, and it does not change shape when Prisma does.
 *
 * `prisma-schema-model.test.mjs` checks this parser against the generated DMMF
 * for every model, so it cannot drift from what Prisma itself understands for
 * as long as the DMMF still carries enough to compare.
 */

const here = path.dirname(url.fileURLToPath(import.meta.url))
export const defaultSchemaPath = path.join(
	here,
	'..',
	'prisma',
	'schema.prisma',
)

/** Strip comments and blank lines without touching string literals. */
function meaningfulLines(source) {
	return source
		.split('\n')
		.map(line => line.replace(/\/\/.*$/, '').trimEnd())
		.filter(line => line.trim().length > 0)
}

function parseRelationAttribute(rest) {
	const match = /@relation\(([^)]*)\)/.exec(rest)
	if (!match) return { fromFields: [], onDelete: null }
	const body = match[1] ?? ''
	const fields = /fields:\s*\[([^\]]*)\]/.exec(body)
	const onDelete = /onDelete:\s*(\w+)/.exec(body)
	return {
		fromFields: fields
			? fields[1]
					.split(',')
					.map(name => name.trim())
					.filter(Boolean)
			: [],
		onDelete: onDelete ? onDelete[1] : null,
	}
}

/**
 * Every model in the schema, with the field facts the guards assert on.
 *
 * `kind` mirrors the DMMF's vocabulary — `object` for a relation, `scalar` for
 * everything else, including enums, which the guards treat the same way.
 */
export function parsePrismaSchema(schemaPath = defaultSchemaPath) {
	const source = fs.readFileSync(schemaPath, 'utf8')
	const models = []
	let current = null

	for (const line of meaningfulLines(source)) {
		const trimmed = line.trim()
		const opening = /^model\s+(\w+)\s*\{$/.exec(trimmed)
		if (opening) {
			current = { name: opening[1], fields: [] }
			continue
		}
		if (!current) continue
		if (trimmed === '}') {
			models.push(current)
			current = null
			continue
		}
		// Block attributes describe the model, not a field.
		if (trimmed.startsWith('@@')) continue

		const field = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(trimmed)
		if (!field) continue
		const [, name, type, list, optional, rest] = field
		const isRelation = /@relation\b/.test(rest) || undefined
		const relation = parseRelationAttribute(rest)
		current.fields.push({
			name,
			type,
			isList: Boolean(list),
			// A list is never null in Prisma; an absent `?` means required.
			isRequired: Boolean(list) || !optional,
			isId: /@id\b/.test(rest),
			relationName: isRelation ? true : undefined,
			relationFromFields: relation.fromFields,
			relationOnDelete: relation.onDelete,
		})
	}
	if (current) {
		throw new Error(`Unterminated model ${current.name} in ${schemaPath}`)
	}
	return models
}

const scalarTypes = new Set([
	'String',
	'Boolean',
	'Int',
	'BigInt',
	'Float',
	'Decimal',
	'DateTime',
	'Json',
	'Bytes',
])

/** Which fields are relations, decided by whether the type names a model. */
export function classifyFields(models) {
	const modelNames = new Set(models.map(model => model.name))
	return models.map(model => ({
		...model,
		fields: model.fields.map(field => ({
			...field,
			kind:
				modelNames.has(field.type) && !scalarTypes.has(field.type)
					? 'object'
					: 'scalar',
		})),
	}))
}

export function schemaModels(schemaPath = defaultSchemaPath) {
	return classifyFields(parsePrismaSchema(schemaPath))
}

export function schemaModel(name, schemaPath = defaultSchemaPath) {
	const model = schemaModels(schemaPath).find(entry => entry.name === name)
	if (!model) throw new Error(`No model named ${name} in ${schemaPath}`)
	return model
}

/** To-many relations on a model, which is what most of the guards enumerate. */
export function listRelations(name, schemaPath = defaultSchemaPath) {
	return schemaModel(name, schemaPath)
		.fields.filter(field => field.kind === 'object' && field.isList)
		.map(field => field.name)
}
