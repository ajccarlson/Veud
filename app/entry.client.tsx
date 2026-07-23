import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { installChunkRecovery } from './utils/chunk-recovery.ts'

// if (ENV.MODE === 'production' && ENV.SENTRY_DSN) {
// 	import('./utils/monitoring.client.tsx').then(({ init }) => init())
// }

installChunkRecovery(window)

startTransition(() => {
	hydrateRoot(document, <HydratedRouter />)
})
