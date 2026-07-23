const RELOAD_KEY = 'veud:stale-chunk-reload'
const RELOAD_COOLDOWN_MS = 30_000

type ChunkRecoveryWindow = Pick<Window, 'addEventListener' | 'location'> & {
	sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
}

/**
 * Vite emits `vite:preloadError` when a lazy route still references a
 * fingerprinted chunk removed by a newer deployment. Reload once to obtain the
 * current route manifest, with a cooldown that prevents a broken deployment
 * from creating a reload loop.
 */
export function installChunkRecovery(
	browser: ChunkRecoveryWindow,
	now: () => number = Date.now,
) {
	browser.addEventListener('vite:preloadError', event => {
		let previous = 0
		try {
			previous = Number(browser.sessionStorage.getItem(RELOAD_KEY) ?? 0)
		} catch {
			// Storage can be unavailable in hardened/private browser contexts.
		}
		const current = now()
		if (Number.isFinite(previous) && current - previous < RELOAD_COOLDOWN_MS) {
			return
		}
		event.preventDefault()
		try {
			browser.sessionStorage.setItem(RELOAD_KEY, String(current))
		} catch {
			// A reload is still safe without the persisted loop guard.
		}
		browser.location.reload()
	})
}
