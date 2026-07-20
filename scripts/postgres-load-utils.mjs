export function assertSafeLoadDatabaseUrl(value) {
	let url
	try {
		url = new URL(value)
	} catch {
		throw new Error('DATABASE_URL must be a valid PostgreSQL URL')
	}
	if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
		throw new Error('DATABASE_URL must use postgresql://')
	}
	const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
	if (
		!/(?:^|[_-])(load|bench|perf|stag(?:e|ing)?|test)(?:[_-]|$)/i.test(database)
	) {
		throw new Error(
			'Load-test database name must contain a delimited load, bench, perf, stage, staging, stag, or test marker',
		)
	}
	return {
		host: url.hostname.toLowerCase(),
		port: url.port || '5432',
		database,
		identity: `${url.hostname.toLowerCase()}:${url.port || '5432'}/${database}`,
	}
}

function explainDocument(value) {
	const parsed = typeof value === 'string' ? JSON.parse(value) : value
	return Array.isArray(parsed) ? parsed[0] : parsed
}

export function summarizeExplain(rows) {
	const raw = rows[0]?.['QUERY PLAN'] ?? rows[0]?.['query_plan']
	if (!raw) throw new Error('PostgreSQL EXPLAIN returned no QUERY PLAN')
	const document = explainDocument(raw)
	const nodeTypes = []
	const indexes = []
	let sharedHitBlocks = 0
	let sharedReadBlocks = 0
	function visit(node) {
		if (!node) return
		if (node['Node Type']) nodeTypes.push(node['Node Type'])
		if (node['Index Name']) indexes.push(node['Index Name'])
		sharedHitBlocks += Number(node['Shared Hit Blocks'] ?? 0)
		sharedReadBlocks += Number(node['Shared Read Blocks'] ?? 0)
		for (const child of node.Plans ?? []) visit(child)
	}
	visit(document.Plan)
	return {
		planningMs: Number(document['Planning Time'] ?? 0),
		executionMs: Number(document['Execution Time'] ?? 0),
		actualRows: Number(document.Plan?.['Actual Rows'] ?? 0),
		nodeTypes: [...new Set(nodeTypes)],
		indexes: [...new Set(indexes)],
		sharedHitBlocks,
		sharedReadBlocks,
	}
}

export function bytesLabel(value) {
	const bytes = Number(value)
	if (!Number.isFinite(bytes) || bytes < 0) return 'unknown'
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
	let size = bytes
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	return `${size.toFixed(unit ? 2 : 0)} ${units[unit]}`
}
