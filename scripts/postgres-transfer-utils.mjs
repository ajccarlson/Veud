export function buildModelTransferPlan(models) {
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
							field.relationFromFields?.length,
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

function convertedDate(value, fieldName) {
	if (value instanceof Date) return value
	const date =
		typeof value === 'number' || typeof value === 'bigint'
			? new Date(Number(value))
			: /^\d+$/.test(String(value))
				? new Date(Number(value))
				: new Date(String(value))
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
				converted[field.name] = BigInt(value) // eslint-disable-line no-undef
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
	const url = new URL(value)
	const port = url.port || '5432'
	return `${url.hostname.toLowerCase()}:${port}/${decodeURIComponent(
		url.pathname.replace(/^\//, ''),
	)}`
}
