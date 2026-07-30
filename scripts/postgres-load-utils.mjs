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
	if (!/(?:^|[_-])(load|bench|perf|test)(?:[_-]|$)/i.test(database)) {
		throw new Error(
			'Load-test database name must contain a delimited load, bench, perf, or test marker',
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

export function assertRequiredQueryIndexes(queryPlans, requirements) {
	if (!Array.isArray(queryPlans)) {
		throw new Error('Query plans must be an array')
	}
	if (
		!requirements ||
		typeof requirements !== 'object' ||
		Array.isArray(requirements)
	) {
		throw new Error('Query index requirements must be an object')
	}

	const missingRequirements = []
	for (const [queryName, requiredIndex] of Object.entries(requirements)) {
		if (
			!queryName ||
			typeof requiredIndex !== 'string' ||
			!requiredIndex.trim()
		) {
			throw new Error('Query index requirements must map names to indexes')
		}
		const measurements = queryPlans.filter(plan => plan?.name === queryName)
		const missingMeasurements = measurements.filter(
			plan =>
				!Array.isArray(plan.indexes) || !plan.indexes.includes(requiredIndex),
		)
		if (measurements.length && !missingMeasurements.length) continue
		missingRequirements.push({
			queryName,
			requiredIndex,
			measurementCount: measurements.length,
			missingMeasurementCount: missingMeasurements.length,
			observedIndexes: [
				...new Set(
					measurements.flatMap(plan =>
						Array.isArray(plan.indexes) ? plan.indexes : [],
					),
				),
			].sort(),
		})
	}
	if (!missingRequirements.length) return

	const failure = new Error(
		`Required query indexes were not used by their matching queries: ${missingRequirements
			.map(requirement => {
				const observation = requirement.measurementCount
					? `${requirement.missingMeasurementCount}/${requirement.measurementCount} measurements missing; observed ${requirement.observedIndexes.join(', ') || 'none'}`
					: 'query was not measured'
				return `${requirement.queryName} -> ${requirement.requiredIndex} (${observation})`
			})
			.join('; ')}`,
	)
	failure.missingRequirements = missingRequirements
	throw failure
}

export function assertRequiredQueryRows(queryPlans, requirements) {
	if (!Array.isArray(queryPlans)) {
		throw new Error('Query plans must be an array')
	}
	if (
		!requirements ||
		typeof requirements !== 'object' ||
		Array.isArray(requirements)
	) {
		throw new Error('Query row requirements must be an object')
	}

	const failures = []
	for (const [queryName, requiredRows] of Object.entries(requirements)) {
		if (!queryName || !Number.isSafeInteger(requiredRows) || requiredRows < 1) {
			throw new Error(
				'Query row requirements must map names to positive integer minimums',
			)
		}
		const measurements = queryPlans.filter(plan => plan?.name === queryName)
		const invalidMeasurements = measurements.filter(
			plan =>
				!Number.isFinite(plan.actualRows) || plan.actualRows < requiredRows,
		)
		if (measurements.length && !invalidMeasurements.length) continue
		failures.push({
			queryName,
			requiredRows,
			measurementCount: measurements.length,
			invalidMeasurementCount: invalidMeasurements.length,
			observedRows: measurements.map(plan => plan.actualRows),
		})
	}

	if (!failures.length) return
	const error = new Error(
		`Required PostgreSQL queries returned too few rows: ${failures
			.map(
				failure =>
					`${failure.queryName} >= ${failure.requiredRows} (observed ${failure.observedRows.join(', ') || 'unmeasured'})`,
			)
			.join('; ')}`,
	)
	error.rowFailures = failures
	throw error
}

export const publicSurfaceLoadBudgets = Object.freeze({
	anonymousHome: Object.freeze({
		coldQueries: 12,
		warmQueries: 4,
		coldSqlQueries: 20,
		warmSqlQueries: 12,
		payloadBytes: 128 * 1024,
	}),
	signedTrending: Object.freeze({
		coldQueries: 6,
		warmQueries: 2,
		coldSqlQueries: 6,
		warmSqlQueries: 2,
		payloadBytes: 128 * 1024,
	}),
	discoveryFacets: Object.freeze({
		coldQueries: 2,
		warmQueries: 0,
		coldSqlQueries: 2,
		warmSqlQueries: 0,
		payloadBytes: 48 * 1024,
	}),
})

export const mediaDetailLoadBudgets = Object.freeze({
	anonymous: Object.freeze({
		logicalQueries: 16,
		sqlQueries: 24,
		payloadBytes: 192 * 1024,
		wallMs: 8_000,
		expectedEntryReads: 0,
		expectedEntrySqlReads: 0,
		expectedTrackingStateLookups: 0,
		expectedTrackingStateLookupSqlReads: 0,
	}),
	normalizedSigned: Object.freeze({
		logicalQueries: 24,
		sqlQueries: 36,
		payloadBytes: 256 * 1024,
		wallMs: 8_000,
		expectedEntryReads: 0,
		expectedEntrySqlReads: 0,
		expectedTrackingStateLookups: 1,
		expectedTrackingStateLookupSqlReads: 1,
	}),
	boundedLegacy: Object.freeze({
		logicalQueries: 25,
		sqlQueries: 37,
		payloadBytes: 256 * 1024,
		wallMs: 8_000,
		expectedEntryReads: 0,
		expectedEntrySqlReads: 1,
		expectedTrackingStateLookups: 1,
		expectedTrackingStateLookupSqlReads: 1,
	}),
})

const mediaDetailMeasurementFields = [
	'logicalQueries',
	'sqlQueries',
	'entryReads',
	'entrySqlReads',
	'trackingStateLookups',
	'trackingStateLookupSqlReads',
	'payloadBytes',
	'wallMs',
]
const legacyEntryPlanFields = [
	'name',
	'wallMs',
	'planningMs',
	'executionMs',
	'actualRows',
	'nodeTypes',
	'indexes',
	'sharedHitBlocks',
	'sharedReadBlocks',
]
const existingLegacyEntryIndexes = new Set([
	'Entry_mediaId_idx',
	'Entry_watchlistId_id_idx',
])

function assertExactObjectFields(value, label, fields) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`)
	}
	const expected = [...fields].sort()
	const observed = Object.keys(value).sort()
	if (
		observed.length !== expected.length ||
		observed.some((field, index) => field !== expected[index])
	) {
		throw new Error(
			`${label} fields must be exactly ${expected.join(', ')}; observed ${observed.join(', ') || 'none'}`,
		)
	}
	return value
}

function mediaDetailMeasurement(report, name) {
	const measurement = assertExactObjectFields(
		report?.[name],
		`Media-detail smoke ${name}`,
		mediaDetailMeasurementFields,
	)
	for (const field of mediaDetailMeasurementFields) {
		const value = measurement[field]
		if (
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			value < 0 ||
			(field !== 'wallMs' && !Number.isSafeInteger(value))
		) {
			throw new Error(
				`Media-detail smoke ${name}.${field} must be a non-negative ${field === 'wallMs' ? 'finite number' : 'integer'}`,
			)
		}
	}
	return measurement
}

export function assertMediaDetailLoadEvidence(
	report,
	budgets = mediaDetailLoadBudgets,
) {
	assertExactObjectFields(report, 'Media-detail smoke report', [
		'version',
		'fixture',
		'anonymous',
		'normalizedSigned',
		'boundedLegacy',
		'privacy',
		'legacyEntryPlan',
	])
	if (report.version !== 1) {
		throw new Error('Media-detail smoke report must use version 1')
	}

	const fixture = assertExactObjectFields(
		report.fixture,
		'Media-detail smoke fixture',
		[
			'representativeMembers',
			'fanoutEntries',
			'privateEntries',
			'hostileHistoryCodeUnits',
			'hostileCounterCodeUnits',
		],
	)
	for (const field of [
		'representativeMembers',
		'fanoutEntries',
		'privateEntries',
		'hostileHistoryCodeUnits',
		'hostileCounterCodeUnits',
	]) {
		if (!Number.isSafeInteger(fixture[field]) || fixture[field] < 0) {
			throw new Error(
				`Media-detail smoke fixture.${field} must be a non-negative integer`,
			)
		}
	}
	if (
		fixture.representativeMembers < 6 ||
		fixture.representativeMembers > 256 ||
		fixture.fanoutEntries !== fixture.representativeMembers ||
		fixture.privateEntries !== fixture.fanoutEntries - 1 ||
		fixture.hostileHistoryCodeUnits !== 1024 * 1024 ||
		fixture.hostileCounterCodeUnits !== 1024 * 1024
	) {
		throw new Error(
			'Media-detail smoke fixture must contain 6-256 representative members, one entry per member, exactly one public-list entry, and exact 1 MiB hostile history/counter values',
		)
	}

	const privacy = assertExactObjectFields(
		report.privacy,
		'Media-detail smoke privacy',
		[
			'privateCatalogTextVisible',
			'linkedFavoritePrivateTextVisible',
			'realNameValueVisible',
			'realNameFieldVisible',
		],
	)
	for (const [field, value] of Object.entries(privacy)) {
		if (value !== false) {
			throw new Error(`Media-detail smoke privacy.${field} must be false`)
		}
	}

	const plan = assertExactObjectFields(
		report.legacyEntryPlan,
		'Media-detail legacy Entry plan',
		legacyEntryPlanFields,
	)
	if (plan.name !== 'media-legacy-owner-entry') {
		throw new Error('Media-detail legacy Entry plan has an unexpected name')
	}
	for (const field of [
		'wallMs',
		'planningMs',
		'executionMs',
		'actualRows',
		'sharedHitBlocks',
		'sharedReadBlocks',
	]) {
		if (
			typeof plan[field] !== 'number' ||
			!Number.isFinite(plan[field]) ||
			plan[field] < 0
		) {
			throw new Error(
				`Media-detail legacy Entry plan.${field} must be a non-negative finite number`,
			)
		}
	}
	for (const field of ['nodeTypes', 'indexes']) {
		if (
			!Array.isArray(plan[field]) ||
			plan[field].some(value => typeof value !== 'string' || !value)
		) {
			throw new Error(
				`Media-detail legacy Entry plan.${field} must be a string array`,
			)
		}
	}
	if (plan.actualRows < 1) {
		throw new Error(
			'Media-detail legacy Entry plan must return at least one owner row',
		)
	}
	if (!plan.indexes.some(index => existingLegacyEntryIndexes.has(index))) {
		throw new Error(
			'Media-detail legacy Entry plan did not use an existing Entry lookup index',
		)
	}

	const failures = []
	for (const [name, budget] of Object.entries(budgets)) {
		const measurement = mediaDetailMeasurement(report, name)
		for (const field of [
			'logicalQueries',
			'sqlQueries',
			'payloadBytes',
			'wallMs',
		]) {
			if (measurement[field] <= budget[field]) continue
			failures.push({
				surface: name,
				field,
				observed: measurement[field],
				budget: budget[field],
			})
		}
		for (const [field, expectedField] of [
			['entryReads', 'expectedEntryReads'],
			['entrySqlReads', 'expectedEntrySqlReads'],
			['trackingStateLookups', 'expectedTrackingStateLookups'],
			['trackingStateLookupSqlReads', 'expectedTrackingStateLookupSqlReads'],
		]) {
			if (measurement[field] === budget[expectedField]) continue
			failures.push({
				surface: name,
				field,
				observed: measurement[field],
				budget: budget[expectedField],
				reason: 'unexpected-exact-value',
			})
		}
		if (measurement.sqlQueries < measurement.logicalQueries) {
			failures.push({
				surface: name,
				field: 'sqlQueries',
				observed: measurement.sqlQueries,
				budget: measurement.logicalQueries,
				reason: 'below-logical-query-count',
			})
		}
	}
	if (!failures.length) return

	const error = new Error(
		`Media-detail load evidence failed: ${failures
			.map(
				failure =>
					`${failure.surface}.${failure.field}=${failure.observed} ${
						failure.reason === 'below-logical-query-count'
							? '<'
							: failure.reason === 'unexpected-exact-value'
								? '!='
								: '>'
					} ${failure.budget}`,
			)
			.join('; ')}`,
	)
	error.budgetFailures = failures
	throw error
}

function publicSurfaceMeasurement(report, name) {
	const measurement = report?.[name]
	if (!measurement || typeof measurement !== 'object') {
		throw new Error(`Public-surface smoke report is missing ${name}`)
	}
	for (const field of [
		'coldQueries',
		'warmQueries',
		'coldSqlQueries',
		'warmSqlQueries',
		'payloadBytes',
	]) {
		if (!Number.isSafeInteger(measurement[field]) || measurement[field] < 0) {
			throw new Error(
				`Public-surface smoke ${name}.${field} must be a non-negative integer`,
			)
		}
	}
	return measurement
}

export function assertPublicSurfaceLoadBudgets(
	report,
	budgets = publicSurfaceLoadBudgets,
) {
	if (!report || typeof report !== 'object' || report.version !== 1) {
		throw new Error('Public-surface smoke report must use version 1')
	}
	const failures = []
	for (const [name, budget] of Object.entries(budgets)) {
		const measurement = publicSurfaceMeasurement(report, name)
		for (const field of [
			'coldQueries',
			'warmQueries',
			'coldSqlQueries',
			'warmSqlQueries',
			'payloadBytes',
		]) {
			if (measurement[field] <= budget[field]) continue
			failures.push({
				surface: name,
				field,
				observed: measurement[field],
				budget: budget[field],
			})
		}
		if (measurement.warmQueries > measurement.coldQueries) {
			failures.push({
				surface: name,
				field: 'warmQueries',
				observed: measurement.warmQueries,
				budget: measurement.coldQueries,
			})
		}
		for (const phase of ['cold', 'warm']) {
			const logicalField = `${phase}Queries`
			const sqlField = `${phase}SqlQueries`
			if (measurement[sqlField] >= measurement[logicalField]) continue
			failures.push({
				surface: name,
				field: sqlField,
				observed: measurement[sqlField],
				budget: measurement[logicalField],
				reason: 'below-logical-query-count',
			})
		}
	}
	if (!failures.length) return

	const error = new Error(
		`Public-surface load budgets exceeded: ${failures
			.map(
				failure =>
					`${failure.surface}.${failure.field}=${failure.observed} ${
						failure.reason === 'below-logical-query-count' ? '<' : '>'
					} ${failure.budget}`,
			)
			.join('; ')}`,
	)
	error.budgetFailures = failures
	throw error
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
	const nullListSlotsPerMember = Math.floor(effectiveTrackingPerMember / 11)
	const listedTrackingRowsPerMember =
		effectiveTrackingPerMember - nullListSlotsPerMember
	const privateMemberCount = Math.floor(memberCount / 7)

	return {
		memberCount,
		watchlistRows: memberCount * 3,
		collectionRows: memberCount * 2,
		publicCollectionRows: memberCount,
		trackingPerMember: effectiveTrackingPerMember,
		trackingRows,
		publicListTrackingRows:
			(memberCount - privateMemberCount) * listedTrackingRowsPerMember,
		privateListTrackingRows: privateMemberCount * listedTrackingRowsPerMember,
		nullListTrackingRows: memberCount * nullListSlotsPerMember,
		entryRows: trackingRows,
		activityPerMember: effectiveActivityPerMember,
		activityRows,
		relationRows: Math.floor((mediaCount - 1) / 10),
		feedRows: Math.floor(mediaCount / 100),
		nextReleaseRows: Math.floor(mediaCount / 20),
		releaseOccurrenceRows: Math.floor(mediaCount / 25),
	}
}

export function representativeProfileEntryShape({
	mediaCount,
	trackedEntries,
}) {
	boundedInteger('mediaCount', mediaCount, { minimum: 1, maximum: 2_000_000 })
	boundedInteger('trackedEntries', trackedEntries, { maximum: 100_000 })
	const expectedEntries = Math.min(mediaCount, 100_000)
	if (trackedEntries > expectedEntries) {
		throw new Error(
			'trackedEntries may not exceed the representative profile target',
		)
	}
	return {
		expectedEntries,
		fixtureEntryRows: expectedEntries - trackedEntries,
	}
}

export function calendarLoadWindow(anchor) {
	const reference = new Date(anchor)
	if (!Number.isFinite(reference.getTime())) {
		throw new Error('calendar load anchor must be a valid timestamp')
	}
	const dayMs = 24 * 60 * 60 * 1_000
	return {
		reference,
		start: new Date(reference.getTime() - dayMs),
		end: new Date(reference.getTime() + 8 * dayMs),
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
