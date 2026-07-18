import 'dotenv/config'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import * as Sentry from '@sentry/react-router'

const dsn = process.env.SENTRY_DSN

if (
	process.env.NODE_ENV === 'production' &&
	dsn &&
	dsn !== 'your-dsn'
) {
	Sentry.init({
		dsn,
		environment: process.env.NODE_ENV,
		integrations: [
			Sentry.prismaIntegration(),
			nodeProfilingIntegration(),
		],
		tracesSampler({ normalizedRequest }) {
			if (normalizedRequest?.url?.includes('/resources/healthcheck')) {
				return 0
			}
			return 1
		},
		beforeSendTransaction(event) {
			if (event.request?.headers?.['x-healthcheck'] === 'true') {
				return null
			}

			return event
		},
	})
}
