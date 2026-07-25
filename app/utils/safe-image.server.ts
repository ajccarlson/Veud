import sharp from 'sharp'

const MAX_IMAGE_PIXELS = 20_000_000

export class UnsafeImageError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'UnsafeImageError'
	}
}

export async function normalizeProfileImage(
	input: Buffer,
	kind: 'avatar' | 'banner',
) {
	try {
		const source = sharp(input, {
			animated: true,
			failOn: 'error',
			limitInputPixels: MAX_IMAGE_PIXELS,
		})
		const metadata = await source.metadata()
		if (!metadata.width || !metadata.height) {
			throw new UnsafeImageError('The image has invalid dimensions.')
		}
		if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
			throw new UnsafeImageError('The image dimensions are too large.')
		}
		if ((metadata.pages ?? 1) > 1) {
			throw new UnsafeImageError('Animated images are not supported.')
		}

		const dimensions =
			kind === 'avatar'
				? { width: 1_024, height: 1_024 }
				: { width: 2_560, height: 1_440 }
		const blob = await sharp(input, {
			failOn: 'error',
			limitInputPixels: MAX_IMAGE_PIXELS,
		})
			.rotate()
			.resize({
				...dimensions,
				fit: 'inside',
				withoutEnlargement: true,
			})
			.webp({ quality: 85, effort: 4 })
			.toBuffer()

		return { blob, contentType: 'image/webp' as const }
	} catch (error) {
		if (error instanceof UnsafeImageError) throw error
		throw new UnsafeImageError('The image could not be safely processed.')
	}
}
