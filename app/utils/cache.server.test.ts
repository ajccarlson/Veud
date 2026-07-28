import { describe, expect, test, vi } from 'vitest'
import { createCacheResourceCloser } from './cache.server.ts'

describe('cache resource lifecycle', () => {
	test('closes the database exactly once', async () => {
		let databaseOpen = true
		const clearTimer = vi.fn()
		const closeDatabase = vi.fn(() => {
			databaseOpen = false
		})
		const closeCacheResources = createCacheResourceCloser({
			clearTimer,
			isDatabaseOpen: () => databaseOpen,
			closeDatabase,
		})

		closeCacheResources()
		closeCacheResources()

		expect(clearTimer).toHaveBeenCalledOnce()
		expect(closeDatabase).toHaveBeenCalledOnce()
		expect(databaseOpen).toBe(false)
	})
})
