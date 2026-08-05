import 'dotenv/config'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import * as Sentry from '@sentry/react-router'

const dsn = process.env.SENTRY_DSN

function sampleRate(name, fallback) {
	const parsed = Number(process.env[name])
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
		? parsed
		: fallback
}

function scrubRequest(event) {
	if (!event.request) return event
	delete event.request.cookies
	delete event.request.data
	if (event.request.headers) {
		for (const key of Object.keys(event.request.headers)) {
			if (/authorization|cookie|token|secret|api[-_]?key/i.test(key)) {
				event.request.headers[key] = '[redacted]'
			}
		}
	}
	return event
}

if (process.env.NODE_ENV === 'production' && dsn && dsn !== 'your-dsn') {
	Sentry.init({
		dsn,
		environment: process.env.VEUD_ENVIRONMENT || process.env.NODE_ENV,
		release: process.env.VEUD_RELEASE,
		sendDefaultPii: false,
		integrations: [Sentry.prismaIntegration(), nodeProfilingIntegration()],
		profilesSampleRate: sampleRate('SENTRY_PROFILES_SAMPLE_RATE', 0.02),
		tracesSampler({ normalizedRequest }) {
			if (normalizedRequest?.url?.includes('/resources/healthcheck')) {
				return 0
			}
			return sampleRate('SENTRY_TRACES_SAMPLE_RATE', 0.1)
		},
		beforeSend(event) {
			return scrubRequest(event)
		},
		beforeSendTransaction(event) {
			// Healthcheck traces are already dropped by `tracesSampler`, which
			// matches on the URL. This previously also filtered an `x-healthcheck`
			// header that nothing has ever sent.
			return scrubRequest(event)
		},
	})
}
