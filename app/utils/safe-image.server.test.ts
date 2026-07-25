import sharp from 'sharp'
import { expect, test } from 'vitest'
import { normalizeProfileImage, UnsafeImageError } from './safe-image.server.ts'

test('normalizes profile images to bounded metadata-free WebP', async () => {
	const input = await sharp({
		create: {
			width: 1_600,
			height: 1_200,
			channels: 3,
			background: '#7c3aed',
		},
	})
		.jpeg()
		.withMetadata({ orientation: 6 })
		.toBuffer()

	const result = await normalizeProfileImage(input, 'avatar')
	const metadata = await sharp(result.blob).metadata()

	expect(result.contentType).toBe('image/webp')
	expect(metadata.format).toBe('webp')
	expect(metadata.width).toBeLessThanOrEqual(1_024)
	expect(metadata.height).toBeLessThanOrEqual(1_024)
	expect(metadata.exif).toBeUndefined()
})

test('rejects data that cannot be decoded as an image', async () => {
	await expect(
		normalizeProfileImage(Buffer.from('not an image'), 'banner'),
	).rejects.toBeInstanceOf(UnsafeImageError)
})
