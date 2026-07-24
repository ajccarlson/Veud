import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { installChunkRecovery } from './utils/chunk-recovery.ts'

installChunkRecovery(window)

startTransition(() => {
	hydrateRoot(document, <HydratedRouter />)
})
