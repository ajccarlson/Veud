export const SAFE_IMAGE_CONTENT_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
] as const

export function isSafeImageContentType(
	value: string,
): value is (typeof SAFE_IMAGE_CONTENT_TYPES)[number] {
	return SAFE_IMAGE_CONTENT_TYPES.includes(
		value as (typeof SAFE_IMAGE_CONTENT_TYPES)[number],
	)
}

function ascii(bytes: Uint8Array, start: number, length: number) {
	return String.fromCharCode(...bytes.slice(start, start + length))
}

export function hasSafeImageSignature(bytes: Uint8Array, contentType: string) {
	if (!isSafeImageContentType(contentType)) return false
	switch (contentType) {
		case 'image/jpeg':
			return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
		case 'image/png':
			return (
				bytes[0] === 0x89 &&
				ascii(bytes, 1, 3) === 'PNG' &&
				bytes[4] === 0x0d &&
				bytes[5] === 0x0a &&
				bytes[6] === 0x1a &&
				bytes[7] === 0x0a
			)
		case 'image/gif':
			return ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))
		case 'image/webp':
			return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
	}
}
