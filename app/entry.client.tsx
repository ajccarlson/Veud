import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { installChunkRecovery } from './utils/chunk-recovery.ts'
import { initializeClientMonitoring } from './utils/monitoring.client.ts'

installChunkRecovery(window)

initializeClientMonitoring(window.ENV)

startTransition(() => {
	hydrateRoot(document, <HydratedRouter />)
})
