import { normalizeCanaryOrigin } from './postgres-canary-utils.mjs'

export const requiredLoadQueries = [
	'canonical-title',
	'alternate-title',
	'rare-description',
	'broad-description',
	'no-match',
	'popular-page',
	'related-media',
	'trending-feed',
	'profile-entries',
	'profile-activity',
]

const backupCountFields = [
	'users',
	'watchlists',
	'entries',
	'media',
	'migrations',
]

function finite(value) {
	return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0
}

function positive(value) {
	return finite(value) && value > 0
}

function parseTimestamp(label, value, errors) {
	const milliseconds = Date.parse(value)
	if (!value || !Number.isFinite(milliseconds)) {
		errors.push(`${label} must be an ISO timestamp`)
		return undefined
	}
	return milliseconds
}

function checkAge(label, value, maximumHours, nowMs, errors) {
	const milliseconds = parseTimestamp(label, value, errors)
	if (milliseconds === undefined) return
	const ageHours = (nowMs - milliseconds) / 3_600_000
	if (ageHours < -5 / 60) errors.push(`${label} is in the future`)
	if (ageHours > maximumHours) {
		errors.push(
			`${label} is ${ageHours.toFixed(2)} hours old; maximum is ${maximumHours}`,
		)
	}
}

function checkTarget(label, value, errors) {
	if (
		typeof value !== 'string' ||
		!value.includes('/') ||
		value.includes('://') ||
		value.includes('@')
	) {
		errors.push(
			`${label} must be a credential-free host:port/database identity`,
		)
	}
}

function validatePolicy(policy, nowMs, errors) {
	if (policy?.version !== 1) errors.push('policy.version must be 1')
	if (
		typeof policy?.approvedBy !== 'string' ||
		policy.approvedBy.trim().length < 3 ||
		/replace_with|placeholder/i.test(policy.approvedBy)
	) {
		errors.push('policy.approvedBy must identify the real approving owner')
	}
	const approvedAt = parseTimestamp(
		'policy.approvedAt',
		policy?.approvedAt,
		errors,
	)
	if (approvedAt !== undefined && approvedAt > nowMs + 5 * 60_000) {
		errors.push('policy.approvedAt is in the future')
	}
	checkTarget(
		'policy.expectedDatabaseTarget',
		policy?.expectedDatabaseTarget,
		errors,
	)
	try {
		if (
			normalizeCanaryOrigin(policy?.expectedCanaryOrigin) !==
			policy?.expectedCanaryOrigin
		) {
			errors.push('policy.expectedCanaryOrigin must be a normalized origin')
		}
	} catch (error) {
		errors.push(
			`policy.expectedCanaryOrigin: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	for (const field of [
		'minimumSyntheticRows',
		'minimumTransferredTables',
		'minimumInsertRowsPerSecond',
		'minimumConcurrentSearches',
		'minimumConcurrentUpdateBatches',
		'minimumSyntheticRelations',
		'minimumSyntheticMembers',
		'minimumSyntheticTrackingRows',
		'minimumSyntheticEntries',
		'minimumSyntheticActivityRows',
		'minimumConcurrentMemberReads',
		'minimumConcurrentTrackingWriteBatches',
		'minimumDatabasePressureSamples',
		'maximumConnectionUtilization',
		'maximumLoadAgeHours',
		'maximumTransferAgeHours',
		'maximumBackupAgeHours',
		'maximumCanaryAgeHours',
		'maximumConcurrentWallMs',
		'maximumCanaryP95Ms',
		'minimumCanaryRequests',
		'minimumCanaryConcurrency',
	]) {
		if (!positive(policy?.[field])) {
			errors.push(`policy.${field} must be a positive number`)
		}
	}
	for (const field of [
		'minimumSyntheticRows',
		'minimumTransferredTables',
		'minimumConcurrentSearches',
		'minimumConcurrentUpdateBatches',
		'minimumSyntheticRelations',
		'minimumSyntheticMembers',
		'minimumSyntheticTrackingRows',
		'minimumSyntheticEntries',
		'minimumSyntheticActivityRows',
		'minimumConcurrentMemberReads',
		'minimumConcurrentTrackingWriteBatches',
		'minimumDatabasePressureSamples',
		'minimumCanaryRequests',
		'minimumCanaryConcurrency',
	]) {
		if (!Number.isSafeInteger(policy?.[field])) {
			errors.push(`policy.${field} must be an integer`)
		}
	}
	if (typeof policy?.requireBackupIdentity !== 'boolean') {
		errors.push('policy.requireBackupIdentity must be a boolean')
	}
	if (typeof policy?.requireInterruptedResume !== 'boolean') {
		errors.push('policy.requireInterruptedResume must be a boolean')
	}
	if (policy?.maximumConnectionUtilization > 1) {
		errors.push('policy.maximumConnectionUtilization must be at most 1')
	}
	if (!nonNegativeInteger(policy?.maximumWaitingLocks)) {
		errors.push('policy.maximumWaitingLocks must be an integer >= 0')
	}
	if (
		!Array.isArray(policy?.requiredCanaryPaths) ||
		!policy.requiredCanaryPaths.length ||
		!policy.requiredCanaryPaths.includes('/resources/healthcheck') ||
		new Set(policy.requiredCanaryPaths).size !==
			policy.requiredCanaryPaths.length ||
		policy.requiredCanaryPaths.some(
			requestPath =>
				typeof requestPath !== 'string' ||
				!requestPath.startsWith('/') ||
				requestPath.startsWith('//') ||
				requestPath.includes('?') ||
				requestPath.includes('#'),
		)
	) {
		errors.push(
			'policy.requiredCanaryPaths must be unique safe paths including /resources/healthcheck',
		)
	}
	for (const queryName of requiredLoadQueries) {
		if (!positive(policy?.maximumQueryExecutionMs?.[queryName])) {
			errors.push(
				`policy.maximumQueryExecutionMs.${queryName} must be positive`,
			)
		}
	}
	for (const field of backupCountFields) {
		if (!nonNegativeInteger(policy?.minimumBackupCounts?.[field])) {
			errors.push(`policy.minimumBackupCounts.${field} must be an integer >= 0`)
		}
	}
}

export function evaluatePostgresCutoverEvidence({
	policy,
	checkpoint,
	loadReport,
	loadCheckpoint,
	backupReceipt,
	canaryReport,
	actualSnapshot,
	actualBackup,
	evidenceSha256 = {},
	now = new Date(),
}) {
	const errors = []
	const nowMs = now.getTime()
	validatePolicy(policy, nowMs, errors)

	if (checkpoint?.version !== 1)
		errors.push('transfer checkpoint version must be 1')
	if (checkpoint?.status !== 'completed') {
		errors.push('transfer checkpoint status must be completed')
	}
	if (
		!Array.isArray(checkpoint?.completedTables) ||
		checkpoint.completedTables.length < policy?.minimumTransferredTables
	) {
		errors.push(
			`transfer checkpoint must contain at least ${policy?.minimumTransferredTables} completed tables`,
		)
	} else if (
		new Set(checkpoint.completedTables).size !==
		checkpoint.completedTables.length
	) {
		errors.push('transfer checkpoint contains duplicate completed tables')
	}
	if (checkpoint?.target !== policy?.expectedDatabaseTarget) {
		errors.push('transfer checkpoint target does not match policy')
	}
	if (
		typeof checkpoint?.sourceSha256 !== 'string' ||
		checkpoint.sourceSha256 !== actualSnapshot?.sha256
	) {
		errors.push('transfer snapshot SHA-256 does not match the checkpoint')
	}
	if (!positive(actualSnapshot?.bytes)) {
		errors.push('transfer snapshot must be a non-empty file')
	}
	checkAge(
		'transfer checkpoint completedAt',
		checkpoint?.completedAt,
		policy?.maximumTransferAgeHours,
		nowMs,
		errors,
	)

	if (loadReport?.version !== 1) errors.push('load report version must be 1')
	checkTarget('load report target', loadReport?.target, errors)
	if (loadReport?.target !== policy?.expectedDatabaseTarget) {
		errors.push('load report target does not match policy')
	}
	if (loadCheckpoint?.version !== 1) {
		errors.push('load checkpoint version must be 1')
	}
	if (loadCheckpoint?.status !== 'completed') {
		errors.push('load checkpoint status must be completed')
	}
	if (loadCheckpoint?.target !== policy?.expectedDatabaseTarget) {
		errors.push('load checkpoint target does not match policy')
	}
	if (
		!nonNegativeInteger(loadReport?.loadedRows) ||
		loadReport.loadedRows < policy?.minimumSyntheticRows
	) {
		errors.push(
			`load report must contain at least ${policy?.minimumSyntheticRows} rows`,
		)
	}
	if (
		loadReport?.requestedRows !== loadReport?.loadedRows ||
		loadReport?.existingRows !== 0 ||
		loadReport?.insertedRows !== loadReport?.loadedRows
	) {
		errors.push('load report must represent a complete initial insertion run')
	}
	if (
		loadCheckpoint?.requestedRows !== loadReport?.requestedRows ||
		loadCheckpoint?.initialRows !== 0 ||
		loadCheckpoint?.loadedRows !== loadReport?.loadedRows
	) {
		errors.push('load checkpoint counts must match the complete initial load')
	}
	if (
		loadReport?.recovery?.checkpointSha256 !== evidenceSha256?.loadCheckpoint
	) {
		errors.push('load checkpoint SHA-256 does not match the load report')
	}
	if (policy?.requireInterruptedResume) {
		const interruptedAt = Date.parse(loadCheckpoint?.interruptedAt)
		const resumedAt = Date.parse(loadCheckpoint?.resumedAt)
		const completedAt = Date.parse(loadCheckpoint?.completedAt)
		if (
			!Number.isFinite(interruptedAt) ||
			!Number.isFinite(resumedAt) ||
			!Number.isFinite(completedAt) ||
			interruptedAt > resumedAt ||
			resumedAt > completedAt ||
			!positive(loadReport?.recovery?.observedRowsAtResume)
		) {
			errors.push(
				'load checkpoint must prove an interrupted run resumed from persisted rows before completion',
			)
		}
	}
	checkAge(
		'load checkpoint completedAt',
		loadCheckpoint?.completedAt,
		policy?.maximumLoadAgeHours,
		nowMs,
		errors,
	)
	for (const [field, policyField, label] of [
		['relationRows', 'minimumSyntheticRelations', 'relations'],
		['memberCount', 'minimumSyntheticMembers', 'members'],
		['trackingRows', 'minimumSyntheticTrackingRows', 'tracking rows'],
		['entryRows', 'minimumSyntheticEntries', 'entries'],
		['activityRows', 'minimumSyntheticActivityRows', 'activity rows'],
	]) {
		const value = loadReport?.representative?.[field]
		const minimum = policy?.[policyField]
		if (!nonNegativeInteger(value) || value < minimum) {
			errors.push(
				`load report must contain at least ${minimum} representative ${label}`,
			)
		}
	}
	if (!positive(loadReport?.storageGrowthBytes)) {
		errors.push('load report must contain positive database growth')
	}
	if (
		!finite(loadReport?.insert?.rowsPerSecond) ||
		loadReport.insert.rowsPerSecond < policy?.minimumInsertRowsPerSecond
	) {
		errors.push(
			`load insert throughput must be at least ${policy?.minimumInsertRowsPerSecond} rows/second`,
		)
	}
	if (
		!Array.isArray(loadReport?.missingTrigramIndexes) ||
		loadReport.missingTrigramIndexes.length
	) {
		errors.push('load report must show every required trigram index in use')
	}
	const queries = new Map(
		Array.isArray(loadReport?.queries)
			? loadReport.queries.map(query => [query.name, query])
			: [],
	)
	for (const queryName of requiredLoadQueries) {
		const executionMs = queries.get(queryName)?.executionMs
		const maximum = policy?.maximumQueryExecutionMs?.[queryName]
		if (!finite(executionMs)) {
			errors.push(`load report is missing query timing: ${queryName}`)
		} else if (finite(maximum) && executionMs > maximum) {
			errors.push(`${queryName} took ${executionMs}ms; maximum is ${maximum}ms`)
		}
	}
	if (
		!finite(loadReport?.concurrency?.wallMs) ||
		loadReport.concurrency.wallMs > policy?.maximumConcurrentWallMs
	) {
		errors.push(
			`concurrent load wall time must be at most ${policy?.maximumConcurrentWallMs}ms`,
		)
	}
	if (
		!nonNegativeInteger(loadReport?.concurrency?.searches) ||
		loadReport.concurrency.searches < policy?.minimumConcurrentSearches
	) {
		errors.push(
			`load report must include at least ${policy?.minimumConcurrentSearches} concurrent searches`,
		)
	}
	if (
		!nonNegativeInteger(loadReport?.concurrency?.updateBatches) ||
		loadReport.concurrency.updateBatches <
			policy?.minimumConcurrentUpdateBatches
	) {
		errors.push(
			`load report must include at least ${policy?.minimumConcurrentUpdateBatches} concurrent update batches`,
		)
	}
	if (
		!nonNegativeInteger(loadReport?.concurrency?.memberReads) ||
		loadReport.concurrency.memberReads < policy?.minimumConcurrentMemberReads
	) {
		errors.push(
			`load report must include at least ${policy?.minimumConcurrentMemberReads} concurrent member reads`,
		)
	}
	if (
		!nonNegativeInteger(loadReport?.concurrency?.trackingWriteBatches) ||
		loadReport.concurrency.trackingWriteBatches <
			policy?.minimumConcurrentTrackingWriteBatches
	) {
		errors.push(
			`load report must include at least ${policy?.minimumConcurrentTrackingWriteBatches} concurrent tracking write batches`,
		)
	}
	const pressure = loadReport?.concurrency?.databasePressure
	if (
		!nonNegativeInteger(pressure?.sampleCount) ||
		pressure.sampleCount < policy?.minimumDatabasePressureSamples
	) {
		errors.push(
			`load report must include at least ${policy?.minimumDatabasePressureSamples} database pressure samples`,
		)
	}
	if (
		!finite(pressure?.peakConnectionUtilization) ||
		pressure.peakConnectionUtilization > policy?.maximumConnectionUtilization
	) {
		errors.push(
			`connection utilization must be at most ${policy?.maximumConnectionUtilization}`,
		)
	}
	if (
		!nonNegativeInteger(pressure?.peakWaitingLocks) ||
		pressure.peakWaitingLocks > policy?.maximumWaitingLocks
	) {
		errors.push(`waiting locks must be at most ${policy?.maximumWaitingLocks}`)
	}
	checkAge(
		'load report measuredAt',
		loadReport?.measuredAt,
		policy?.maximumLoadAgeHours,
		nowMs,
		errors,
	)

	if (backupReceipt?.version !== 1)
		errors.push('backup receipt version must be 1')
	if (backupReceipt?.sourceTarget !== policy?.expectedDatabaseTarget) {
		errors.push('backup receipt source target does not match policy')
	}
	if (
		!backupReceipt?.restoreTarget ||
		backupReceipt.restoreTarget === backupReceipt.sourceTarget
	) {
		errors.push('backup receipt must identify a distinct restore target')
	}
	if (backupReceipt?.archive?.name !== actualBackup?.name) {
		errors.push(
			'backup receipt archive name does not match the supplied backup',
		)
	}
	if (backupReceipt?.archive?.bytes !== actualBackup?.bytes) {
		errors.push(
			'backup receipt archive size does not match the supplied backup',
		)
	}
	if (backupReceipt?.archive?.sha256 !== actualBackup?.sha256) {
		errors.push(
			'backup receipt archive SHA-256 does not match the supplied backup',
		)
	}
	if (
		policy?.requireBackupIdentity &&
		backupReceipt?.checks?.expectedIdentity !== true
	) {
		errors.push('backup receipt must include the expected identity check')
	}
	for (const field of backupCountFields) {
		const count = backupReceipt?.summary?.[field]
		const minimum = policy?.minimumBackupCounts?.[field]
		if (!nonNegativeInteger(count) || count < minimum) {
			errors.push(`backup ${field} count must be at least ${minimum}`)
		}
	}
	checkAge(
		'backup receipt verifiedAt',
		backupReceipt?.verifiedAt,
		policy?.maximumBackupAgeHours,
		nowMs,
		errors,
	)

	if (canaryReport?.version !== 1)
		errors.push('canary report version must be 1')
	if (canaryReport?.origin !== policy?.expectedCanaryOrigin) {
		errors.push('canary origin does not match policy')
	}
	if (
		!nonNegativeInteger(canaryReport?.requestCount) ||
		canaryReport.requestCount < policy?.minimumCanaryRequests
	) {
		errors.push(
			`canary report must contain at least ${policy?.minimumCanaryRequests} requests`,
		)
	}
	if (
		!nonNegativeInteger(canaryReport?.concurrency) ||
		canaryReport.concurrency < policy?.minimumCanaryConcurrency
	) {
		errors.push(
			`canary concurrency must be at least ${policy?.minimumCanaryConcurrency}`,
		)
	}
	if (
		canaryReport?.summary?.failed !== 0 ||
		canaryReport?.summary?.passed !== canaryReport?.requestCount
	) {
		errors.push('every canary request must pass')
	}
	if (
		!finite(canaryReport?.summary?.p95Ms) ||
		canaryReport.summary.p95Ms > policy?.maximumCanaryP95Ms
	) {
		errors.push(`canary p95 must be at most ${policy?.maximumCanaryP95Ms}ms`)
	}
	const canaryPaths = new Map(
		Array.isArray(canaryReport?.paths)
			? canaryReport.paths.map(path => [path.path, path])
			: [],
	)
	for (const requestPath of policy?.requiredCanaryPaths ?? []) {
		const result = canaryPaths.get(requestPath)
		if (!result || result.failed !== 0 || !positive(result.passed)) {
			errors.push(`canary report must include a passing ${requestPath} check`)
		}
	}
	checkAge(
		'canary report measuredAt',
		canaryReport?.measuredAt,
		policy?.maximumCanaryAgeHours,
		nowMs,
		errors,
	)

	if (errors.length) {
		throw new Error(
			`PostgreSQL cutover evidence failed:\n${errors.map(error => `- ${error}`).join('\n')}`,
		)
	}

	return {
		version: 1,
		status: 'passed',
		evaluatedAt: now.toISOString(),
		target: policy.expectedDatabaseTarget,
		canaryOrigin: policy.expectedCanaryOrigin,
		approval: {
			approvedBy: policy.approvedBy.trim(),
			approvedAt: policy.approvedAt,
		},
		evidence: {
			transfer: {
				completedAt: checkpoint.completedAt,
				snapshotSha256: actualSnapshot.sha256,
				checkpointSha256: evidenceSha256.checkpoint,
			},
			load: {
				measuredAt: loadReport.measuredAt,
				loadedRows: loadReport.loadedRows,
				rowsPerSecond: loadReport.insert.rowsPerSecond,
				representative: loadReport.representative,
				databasePressure: loadReport.concurrency.databasePressure,
				checkpointSha256: evidenceSha256.loadCheckpoint,
				reportSha256: evidenceSha256.loadReport,
			},
			backup: {
				verifiedAt: backupReceipt.verifiedAt,
				archiveName: actualBackup.name,
				archiveSha256: actualBackup.sha256,
				receiptSha256: evidenceSha256.backupReceipt,
			},
			canary: {
				measuredAt: canaryReport.measuredAt,
				requests: canaryReport.requestCount,
				p95Ms: canaryReport.summary.p95Ms,
				reportSha256: evidenceSha256.canaryReport,
			},
			policySha256: evidenceSha256.policy,
		},
	}
}
