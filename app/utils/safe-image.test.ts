import { expect, test } from 'vitest'
import { hasSafeImageSignature, isSafeImageContentType } from './safe-image.ts'

test('allows only browser-safe raster image content types', () => {
	expect(isSafeImageContentType('image/png')).toBe(true)
	expect(isSafeImageContentType('image/jpeg')).toBe(true)
	expect(isSafeImageContentType('image/svg+xml')).toBe(false)
	expect(isSafeImageContentType('text/html')).toBe(false)
})

test('checks that claimed image types have matching file signatures', () => {
	expect(
		hasSafeImageSignature(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			'image/png',
		),
	).toBe(true)
	expect(
		hasSafeImageSignature(
			new TextEncoder().encode('<script>alert(1)</script>'),
			'image/png',
		),
	).toBe(false)
	expect(
		hasSafeImageSignature(
			new TextEncoder().encode('<svg onload="alert(1)">'),
			'image/svg+xml',
		),
	).toBe(false)
})
