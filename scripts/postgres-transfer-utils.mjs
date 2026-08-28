/** Identifier quoting. SQLite and PostgreSQL both use doubled double-quotes. */
export function quotedIdentifier(value) {
	return `"${value.replaceAll('"', '""')}"`
}

/**
 * Relation columns that cannot be filled at insert time.
 *
 * Two models can legitimately point at each other — a moderation report cites
 * the action it appeals, and an action cites the report it came from — and no
 * insertion order satisfies both. Where the foreign key on one side is
 * nullable, the rows can go in with that column empty and be filled once every
 * row exists, so this picks nullable edges to drop until the graph is acyclic
 * and reports them for the caller to back-fill.
 *
 * A cycle with no nullable edge in it is a genuine one and still throws: there
 * is no order, and nothing that can be deferred.
 *
 * Returns a Map of model name to the set of scalar column names to defer.
 */
export function planDeferredRelations(models) {
	const names = new Set(models.map(model => model.name))
	const byName = new Map(models.map(model => [model.name, model]))
	const deferred = new Map()

	const isDeferred = (modelName, field) => {
		const columns = deferred.get(modelName)
		return (
			Boolean(columns) &&
			field.relationFromFields.every(column => columns.has(column))
		)
	}
	const relationFields = model =>
		model.fields.filter(
			field =>
				field.kind === 'object' &&
				field.type !== model.name &&
				field.relationFromFields?.length &&
				names.has(field.type),
		)
	// A relation is deferrable only when every column backing it is nullable.
	// A missing scalar field is treated as required, so an incompletely
	// described model is never silently deferred.
	const deferrable = (model, field) =>
		field.relationFromFields.every(column => {
			const scalar = model.fields.find(candidate => candidate.name === column)
			return Boolean(scalar) && scalar.isRequired === false
		})

	for (;;) {
		const pending = new Set(names)
		for (;;) {
			const ready = [...pending].filter(name =>
				relationFields(byName.get(name))
					.filter(field => !isDeferred(name, field))
					.every(field => !pending.has(field.type)),
			)
			if (!ready.length) break
			for (const name of ready) pending.delete(name)
		}
		if (!pending.size) return deferred

		// Stuck. Break one nullable edge inside the cycle and try again, taking
		// the first in name order so the plan is the same on every run.
		const candidates = []
		for (const name of [...pending].sort()) {
			const model = byName.get(name)
			for (const field of relationFields(model)) {
				if (!pending.has(field.type)) continue
				if (isDeferred(name, field)) continue
				if (!deferrable(model, field)) continue
				candidates.push({ name, field })
			}
		}
		candidates.sort((left, right) =>
			left.name === right.name
				? left.field.name.localeCompare(right.field.name)
				: left.name.localeCompare(right.name),
		)
		const chosen = candidates[0]
		if (!chosen) {
			throw new Error(
				`Prisma model dependency cycle: ${[...pending].sort().join(', ')}`,
			)
		}
		const columns = deferred.get(chosen.name) ?? new Set()
		for (const column of chosen.field.relationFromFields) columns.add(column)
		deferred.set(chosen.name, columns)
	}
}

export function buildModelTransferPlan(
	models,
	deferred = planDeferredRelations(models),
) {
	const names = new Set(models.map(model => model.name))
	const dependencies = new Map(
		models.map(model => [
			model.name,
			new Set(
				model.fields
					.filter(
						field =>
							field.kind === 'object' &&
							field.type !== model.name &&
							field.relationFromFields?.length &&
							!field.relationFromFields.every(column =>
								deferred.get(model.name)?.has(column),
							),
					)
					.map(field => field.type)
					.filter(name => names.has(name)),
			),
		]),
	)
	const pending = new Set(names)
	const plan = []
	while (pending.size) {
		const ready = [...pending]
			.filter(name =>
				[...dependencies.get(name)].every(
					dependency => !pending.has(dependency),
				),
			)
			.sort()
		if (!ready.length) {
			throw new Error(
				`Prisma model dependency cycle: ${[...pending].sort().join(', ')}`,
			)
		}
		for (const name of ready) {
			pending.delete(name)
			plan.push(name)
		}
	}
	return plan
}

/**
 * A SQLite timestamp written without a zone.
 *
 * `DEFAULT CURRENT_TIMESTAMP` stores 'YYYY-MM-DD HH:MM:SS', and it stores it in
 * UTC. `new Date()` parses that space-separated form as **local** time, so the
 * same snapshot transferred from two machines produced two different instants —
 * seven hours apart on a UTC-7 host, nine the other way from UTC+9 — while
 * Prisma's own SQLite reader treats the text as UTC regardless of the machine.
 * The transfer has to agree with the reader that defines what the value means.
 */
const naiveSqliteTimestamp =
	/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/

function convertedDate(value, fieldName) {
	if (value instanceof Date) return value
	const text = String(value)
	const naive = naiveSqliteTimestamp.exec(text)
	const date =
		typeof value === 'number' || typeof value === 'bigint'
			? new Date(Number(value))
			: /^\d+$/.test(text)
				? new Date(Number(value))
				: naive
					? new Date(`${naive[1]}T${naive[2]}Z`)
					: new Date(text)
	if (!Number.isFinite(date.getTime())) {
		throw new Error(`Invalid SQLite DateTime in ${fieldName}: ${value}`)
	}
	return date
}

export function convertSqliteRow(model, row) {
	const converted = {}
	for (const field of model.fields) {
		if (field.kind !== 'scalar' || !(field.name in row)) continue
		const value = row[field.name]
		if (value === null) {
			converted[field.name] = null
			continue
		}
		switch (field.type) {
			case 'DateTime':
				converted[field.name] = convertedDate(
					value,
					`${model.name}.${field.name}`,
				)
				break
			case 'Boolean':
				converted[field.name] = Boolean(value)
				break
			case 'Int':
			case 'Float':
				converted[field.name] = Number(value)
				break
			case 'BigInt':
				converted[field.name] = BigInt(value)
				break
			default:
				converted[field.name] = value
		}
	}
	return converted
}

function relationKey(row, fields) {
	if (!fields.length || fields.some(field => row[field] == null)) return null
	return JSON.stringify(fields.map(field => row[field]))
}

export function sortRowsForSelfRelations(model, rows) {
	const relations = model.fields.filter(
		field =>
			field.kind === 'object' &&
			field.type === model.name &&
			field.relationFromFields?.length,
	)
	if (!relations.length) return rows

	const keyFields = model.primaryKey?.fields?.length
		? model.primaryKey.fields
		: model.fields.filter(field => field.isId).map(field => field.name)
	if (!keyFields.length) {
		throw new Error(`${model.name} has self-relations but no primary key`)
	}
	const rowsByKey = new Map(rows.map(row => [relationKey(row, keyFields), row]))
	const pending = new Map(rowsByKey)
	const emitted = new Set()
	const ordered = []

	while (pending.size) {
		let progressed = false
		for (const [key, row] of pending) {
			const dependencies = relations
				.map(relation => relationKey(row, relation.relationFromFields))
				.filter(Boolean)
			const missing = dependencies.find(
				dependency => !rowsByKey.has(dependency),
			)
			if (missing) {
				throw new Error(`${model.name} self-relation references a missing row`)
			}
			if (dependencies.some(dependency => !emitted.has(dependency))) continue
			pending.delete(key)
			emitted.add(key)
			ordered.push(row)
			progressed = true
		}
		if (!progressed) {
			throw new Error(`${model.name} contains a self-relation cycle`)
		}
	}
	return ordered
}

export function assertPostgresDatabaseUrl(value) {
	if (!value || !/^postgres(?:ql)?:\/\//i.test(value.trim())) {
		throw new Error('DATABASE_URL must use the postgresql:// protocol')
	}
}

export function postgresTargetIdentity(value) {
	assertPostgresDatabaseUrl(value)
	let url
	try {
		url = new URL(value)
	} catch {
		throw new Error('DATABASE_URL must be a valid PostgreSQL URL')
	}
	const port = url.port || '5432'
	return `${url.hostname.toLowerCase()}:${port}/${decodeURIComponent(
		url.pathname.replace(/^\//, ''),
	)}`
}

const migrationSeededReferenceTables = new Set([
	'ListType',
	'Permission',
	'Role',
	'_PermissionToRole',
])

export function containsOnlyMigrationSeededReferenceRows(counts) {
	const occupied = [...counts].filter(([, count]) => count > 0)
	return (
		occupied.length > 0 &&
		occupied.every(([name]) => migrationSeededReferenceTables.has(name))
	)
}

/** Columns held back to break a relation cycle, filled by the back-fill pass. */
export function blankDeferred(converted, deferredColumns) {
	if (!deferredColumns?.size) return converted
	for (const column of deferredColumns) {
		if (column in converted) converted[column] = null
	}
	return converted
}

export function modelKeyFields(model) {
	return model.primaryKey?.fields?.length
		? model.primaryKey.fields
		: model.fields.filter(field => field.isId).map(field => field.name)
}

/**
 * Fill the columns that were held back so the rows could be inserted at all.
 *
 * Reads the values back out of the snapshot rather than carrying them in
 * memory, so this stays bounded on a large table and is safe to re-run: every
 * update writes the value the snapshot already holds.
 */
export async function backfillDeferredRelations({
	client,
	source,
	model,
	columns,
	batchSize,
	delegateFor,
	onProgress,
}) {
	const table = model.dbName ?? model.name
	const keyFields = modelKeyFields(model)
	if (!keyFields.length) {
		throw new Error(`${model.name} has deferred relations but no primary key`)
	}
	const selected = [...new Set([...keyFields, ...columns])]
		.map(quotedIdentifier)
		.join(', ')
	const present = [...columns]
		.map(column => `${quotedIdentifier(column)} IS NOT NULL`)
		.join(' OR ')
	const total = Number(
		source
			.prepare(
				`SELECT COUNT(*) AS count FROM ${quotedIdentifier(table)} WHERE ${present}`,
			)
			.get().count,
	)
	let updated = 0
	for (let offset = 0; offset < total; offset += batchSize) {
		const rows = source
			.prepare(
				`SELECT ${selected} FROM ${quotedIdentifier(table)}
				 WHERE ${present} ORDER BY rowid LIMIT ? OFFSET ?`,
			)
			.all(batchSize, offset)
		for (const row of rows) {
			const converted = convertSqliteRow(model, row)
			const where = Object.fromEntries(
				keyFields.map(field => [field, converted[field]]),
			)
			const data = Object.fromEntries(
				[...columns].map(column => [column, converted[column] ?? null]),
			)
			const result = await delegateFor(client, model.name).updateMany({
				where,
				data,
			})
			updated += result.count
		}
		onProgress(Math.min(offset + rows.length, total), total, updated)
	}
	return { total, updated }
}
