const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function serializeEnvironmentValue(value) {
	return JSON.stringify(String(value))
}

export function replaceEnvironmentValues(source, replacements) {
	const lines = source.replace(/\r\n/g, '\n').split('\n')
	const remaining = new Map(Object.entries(replacements))

	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(
			/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=).*$/,
		)
		if (!match || !remaining.has(match[2])) continue

		lines[index] =
			match[1] +
			match[2] +
			match[3] +
			serializeEnvironmentValue(remaining.get(match[2]))
		remaining.delete(match[2])
	}

	if (remaining.size > 0 && lines.at(-1) !== '') lines.push('')
	for (const [key, value] of remaining) {
		if (!ENV_KEY_PATTERN.test(key)) {
			throw new Error(`Invalid environment key: ${key}`)
		}
		lines.push(`${key}=${serializeEnvironmentValue(value)}`)
	}

	return lines.join('\n')
}

export function assertProductionDatabaseUrl(value) {
	const url = new URL(value)
	if (
		url.protocol !== 'postgresql:' ||
		url.hostname !== '127.0.0.1' ||
		url.port !== '5433' ||
		url.pathname !== '/veud_production'
	) {
		throw new Error('Refusing to select an unexpected production database')
	}
	return `${url.hostname}:${url.port}${url.pathname}`
}
