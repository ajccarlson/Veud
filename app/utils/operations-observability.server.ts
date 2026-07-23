import crypto from 'node:crypto'

const MAX_DURATIONS = 500
const MAX_ERRORS = 25
const MAX_TEXT_LENGTH = 240
const STATE_SYMBOL = Symbol.for('veud.operations-observability')

type StatusBucket = '2xx' | '3xx' | '4xx' | '5xx' | 'other'

export type OperationalError = {
	at: string
	requestId: string
	method: string
	path: string
	status: number
	name: string
	message: string
}

type OperationsState = {
	startedAt: number
	totalRequests: number
	completedRequests: number
	inFlight: number
	lastRequestAt: number | null
	statuses: Record<StatusBucket, number>
	durations: number[]
	recentErrors: OperationalError[]
}

type OperationsGlobal = typeof globalThis & {
	[STATE_SYMBOL]?: OperationsState
}

function createState(): OperationsState {
	return {
		startedAt: Date.now(),
		totalRequests: 0,
		completedRequests: 0,
		inFlight: 0,
		lastRequestAt: null,
		statuses: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 },
		durations: [],
		recentErrors: [],
	}
}

function getState() {
	const operationsGlobal = globalThis as OperationsGlobal
	operationsGlobal[STATE_SYMBOL] ??= createState()
	return operationsGlobal[STATE_SYMBOL]
}

function boundedText(value: unknown, fallback: string) {
	if (typeof value !== 'string') return fallback
	const normalized = value
		.replace(/[\r\n\t]/g, ' ')
		.replace(
			/\b(password|token|secret|authorization|code|api[_-]?key)=([^&\s]+)/gi,
			'$1=[redacted]',
		)
		.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?[redacted]')
		.trim()
	return normalized.slice(0, MAX_TEXT_LENGTH) || fallback
}

export function safeRequestPath(value: string) {
	try {
		return new URL(value, 'http://veud.invalid').pathname
	} catch {
		return '/'
	}
}

function statusBucket(status: number): StatusBucket {
	if (status >= 200 && status < 300) return '2xx'
	if (status >= 300 && status < 400) return '3xx'
	if (status >= 400 && status < 500) return '4xx'
	if (status >= 500 && status < 600) return '5xx'
	return 'other'
}

function percentile(values: number[], value: number) {
	if (!values.length) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * value) - 1),
	)
	return Number(sorted[index]?.toFixed(1))
}

export function createRequestId() {
	return crypto.randomUUID()
}

export function expressErrorStatus(error: unknown) {
	if (!error || typeof error !== 'object') return 500
	const candidate =
		'status' in error && typeof error.status === 'number'
			? error.status
			: 'statusCode' in error && typeof error.statusCode === 'number'
				? error.statusCode
				: null
	return candidate && candidate >= 400 && candidate <= 599 ? candidate : 500
}

export function beginObservedRequest() {
	const state = getState()
	state.totalRequests += 1
	state.inFlight += 1
	state.lastRequestAt = Date.now()
	const startedAt = performance.now()
	let completed = false

	return (status: number) => {
		if (completed) return 0
		completed = true
		const durationMs = Math.max(0, performance.now() - startedAt)
		state.completedRequests += 1
		state.inFlight = Math.max(0, state.inFlight - 1)
		state.statuses[statusBucket(status)] += 1
		state.durations.push(durationMs)
		if (state.durations.length > MAX_DURATIONS) {
			state.durations.splice(0, state.durations.length - MAX_DURATIONS)
		}
		return Number(durationMs.toFixed(1))
	}
}

export function recordOperationalError(input: {
	requestId: string
	method: string
	path: string
	status: number
	error: unknown
}) {
	const error =
		input.error instanceof Error
			? input.error
			: new Error(boundedText(input.error, 'Unknown error'))
	const event: OperationalError = {
		at: new Date().toISOString(),
		requestId: boundedText(input.requestId, 'unknown'),
		method: boundedText(input.method, 'UNKNOWN'),
		path: safeRequestPath(input.path),
		status: input.status,
		name: boundedText(error.name, 'Error'),
		message: boundedText(error.message, 'Unexpected server error'),
	}
	const state = getState()
	state.recentErrors.unshift(event)
	state.recentErrors.splice(MAX_ERRORS)
	return event
}

export function releaseMetadata() {
	const rawRelease =
		process.env.VEUD_RELEASE?.trim() ||
		process.env.SENTRY_RELEASE?.trim() ||
		process.env.GIT_COMMIT_SHA?.trim() ||
		process.env.SOURCE_COMMIT?.trim() ||
		'local'
	const rawEnvironment =
		process.env.VEUD_ENVIRONMENT?.trim() ||
		process.env.NODE_ENV ||
		'development'
	return {
		release: rawRelease.replace(/[^a-z0-9._/-]/gi, '-').slice(0, 80),
		environment: rawEnvironment.replace(/[^a-z0-9._-]/gi, '-').slice(0, 40),
	}
}

export function getRuntimeOperationsSnapshot() {
	const state = getState()
	const completed = state.completedRequests
	const failures = state.statuses['5xx']
	const memory = process.memoryUsage()
	return {
		generatedAt: new Date().toISOString(),
		startedAt: new Date(state.startedAt).toISOString(),
		uptimeSeconds: Math.max(
			0,
			Math.round((Date.now() - state.startedAt) / 1000),
		),
		requests: {
			total: state.totalRequests,
			completed,
			inFlight: state.inFlight,
			lastRequestAt: state.lastRequestAt
				? new Date(state.lastRequestAt).toISOString()
				: null,
			statuses: { ...state.statuses },
			errorRatePercent: completed
				? Number(((failures / completed) * 100).toFixed(2))
				: 0,
			p50Ms: percentile(state.durations, 0.5),
			p95Ms: percentile(state.durations, 0.95),
			sampleSize: state.durations.length,
		},
		process: {
			node: process.version,
			pid: process.pid,
			residentMemoryMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
			heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
		},
		recentErrors: [...state.recentErrors],
		...releaseMetadata(),
	}
}

export function writeStructuredLog(
	level: 'info' | 'warn' | 'error',
	event: string,
	fields: Record<string, string | number | boolean | null>,
) {
	const entry = JSON.stringify({
		timestamp: new Date().toISOString(),
		level,
		event,
		...fields,
	})
	if (level === 'error') console.error(entry)
	else if (level === 'warn') console.warn(entry)
	else console.info(entry)
}

export function resetOperationsStateForTest() {
	;(globalThis as OperationsGlobal)[STATE_SYMBOL] = createState()
}
