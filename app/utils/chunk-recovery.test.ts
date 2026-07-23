import { expect, test, vi } from 'vitest'
import { installChunkRecovery } from './chunk-recovery.ts'

test('reloads once for a stale deployment chunk and prevents a reload loop', () => {
	let listener: ((event: Event) => void) | undefined
	const values = new Map<string, string>()
	const reload = vi.fn()
	const browser = {
		addEventListener: vi.fn(
			(_name: string, next: (event: Event) => void) => (listener = next),
		),
		location: { reload },
		sessionStorage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		},
	} as unknown as Window
	const preventDefault = vi.fn()

	installChunkRecovery(browser, () => 40_000)
	listener?.({ preventDefault } as unknown as Event)
	listener?.({ preventDefault } as unknown as Event)

	expect(preventDefault).toHaveBeenCalledTimes(1)
	expect(reload).toHaveBeenCalledTimes(1)
})

test('retries recovery after the cooldown', () => {
	let listener: ((event: Event) => void) | undefined
	const reload = vi.fn()
	const browser = {
		addEventListener: (_name: string, next: (event: Event) => void) =>
			(listener = next),
		location: { reload },
		sessionStorage: {
			getItem: () => '1000',
			setItem: vi.fn(),
		},
	} as unknown as Window

	installChunkRecovery(browser, () => 32_000)
	listener?.({ preventDefault: vi.fn() } as unknown as Event)
	expect(reload).toHaveBeenCalledOnce()
})
