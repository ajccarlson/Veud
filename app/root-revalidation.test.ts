import { expect, test } from 'vitest'
import { shouldRevalidate } from './root.tsx'

const base = {
	currentUrl: new URL('https://veud.example/users/member'),
	nextUrl: new URL('https://veud.example/users/member/stats'),
	defaultShouldRevalidate: true,
} as any

test('ordinary client navigation keeps stable root data', () => {
	expect(shouldRevalidate(base)).toBe(false)
	expect(
		shouldRevalidate({
			...base,
			nextUrl: new URL('https://veud.example/discover?q=movie'),
		}),
	).toBe(false)
})

test('actions and explicit same-page refreshes revalidate root data', () => {
	expect(shouldRevalidate({ ...base, formMethod: 'POST' })).toBe(true)
	expect(
		shouldRevalidate({
			...base,
			nextUrl: base.currentUrl,
		}),
	).toBe(true)
})
