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

function boundedInteger(label, value, { minimum = 0, maximum }) {
	if (
		!Number.isSafeInteger(value) ||
		value < minimum ||
		(maximum !== undefined && value > maximum)
	) {
		const range =
			maximum === undefined
				? `at least ${minimum}`
				: `from ${minimum} through ${maximum}`
		throw new Error(`${label} must be an integer ${range}`)
	}
	return value
}

export function representativeLoadShape({
	mediaCount,
	memberCount = 0,
	trackingPerMember = 100,
	activityPerMember = 20,
}) {
	boundedInteger('mediaCount', mediaCount, { minimum: 1, maximum: 2_000_000 })
	boundedInteger('memberCount', memberCount, { maximum: 100_000 })
	boundedInteger('trackingPerMember', trackingPerMember, {
		minimum: 1,
		maximum: 10_000,
	})
	boundedInteger('activityPerMember', activityPerMember, {
		maximum: 1_000,
	})

	const effectiveTrackingPerMember = Math.min(trackingPerMember, mediaCount)
	const effectiveActivityPerMember = Math.min(
		activityPerMember,
		effectiveTrackingPerMember,
	)
	const trackingRows = memberCount * effectiveTrackingPerMember
	const activityRows = memberCount * effectiveActivityPerMember
	if (trackingRows > 5_000_000) {
		throw new Error(
			'representative member load may not exceed 5,000,000 tracking rows',
		)
	}

	return {
		memberCount,
		watchlistRows: memberCount * 3,
		trackingPerMember: effectiveTrackingPerMember,
		trackingRows,
		entryRows: trackingRows,
		activityPerMember: effectiveActivityPerMember,
		activityRows,
		relationRows: Math.floor((mediaCount - 1) / 10),
		feedRows: Math.floor(mediaCount / 100),
	}
}

function validTimestamp(value) {
	return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function validateLoadCheckpoint(checkpoint, expected) {
	const errors = []
	if (checkpoint?.version !== 1) errors.push('version must be 1')
	if (!['loading', 'interrupted', 'completed'].includes(checkpoint?.status)) {
		errors.push('status must be loading, interrupted, or completed')
	}
	if (checkpoint?.target !== expected.target) errors.push('target changed')
	for (const field of [
		'requestedRows',
		'memberCount',
		'trackingPerMember',
		'activityPerMember',
	]) {
		if (checkpoint?.[field] !== expected[field]) {
			errors.push(`${field} changed`)
		}
	}
	for (const field of [
		'initialRows',
		'loadedRows',
		'batchesCompleted',
		'insertWallMs',
	]) {
		if (
			typeof checkpoint?.[field] !== 'number' ||
			!Number.isFinite(checkpoint[field]) ||
			checkpoint[field] < 0
		) {
			errors.push(`${field} must be a non-negative number`)
		}
	}
	if (checkpoint?.loadedRows > checkpoint?.requestedRows) {
		errors.push('loadedRows exceeds requestedRows')
	}
	if (checkpoint?.initialRows > checkpoint?.loadedRows) {
		errors.push('initialRows exceeds loadedRows')
	}
	if (
		!checkpoint?.storageBefore ||
		!Number.isFinite(checkpoint.storageBefore.databaseBytes) ||
		checkpoint.storageBefore.databaseBytes <= 0
	) {
		errors.push('storageBefore must contain the initial database size')
	}
	for (const field of ['startedAt', 'updatedAt']) {
		if (!validTimestamp(checkpoint?.[field])) {
			errors.push(`${field} must be an ISO timestamp`)
		}
	}
	if (
		checkpoint?.status === 'interrupted' &&
		!validTimestamp(checkpoint?.interruptedAt)
	) {
		errors.push('interruptedAt must record the interruption')
	}
	if (
		checkpoint?.status === 'completed' &&
		!validTimestamp(checkpoint?.completedAt)
	) {
		errors.push('completedAt must record completion')
	}
	if (errors.length) {
		throw new Error(`Load checkpoint is incompatible:\n${errors.join('\n')}`)
	}
	return checkpoint
}

export function summarizeDatabasePressure(samples) {
	if (!Array.isArray(samples) || !samples.length) {
		throw new Error('At least one database pressure sample is required')
	}
	const normalized = samples.map(sample => {
		const values = {
			maxConnections: Number(sample.maxConnections),
			totalConnections: Number(sample.totalConnections),
			activeConnections: Number(sample.activeConnections),
			waitingLocks: Number(sample.waitingLocks),
		}
		if (
			!Number.isFinite(values.maxConnections) ||
			values.maxConnections <= 0 ||
			Object.entries(values).some(
				([field, value]) =>
					field !== 'maxConnections' && (!Number.isFinite(value) || value < 0),
			)
		) {
			throw new Error('Database pressure samples must contain finite counts')
		}
		return values
	})
	const maxConnections = Math.max(
		...normalized.map(sample => sample.maxConnections),
	)
	const peakTotalConnections = Math.max(
		...normalized.map(sample => sample.totalConnections),
	)
	return {
		sampleCount: normalized.length,
		maxConnections,
		peakTotalConnections,
		peakActiveConnections: Math.max(
			...normalized.map(sample => sample.activeConnections),
		),
		peakWaitingLocks: Math.max(
			...normalized.map(sample => sample.waitingLocks),
		),
		peakConnectionUtilization: Number(
			(peakTotalConnections / maxConnections).toFixed(4),
		),
	}
}
