import crypto from 'node:crypto'

export function isInternalCommandAuthorized(
	request: Request,
	token = process.env.INTERNAL_COMMAND_TOKEN,
) {
	const configuredToken = token?.trim()
	if (!configuredToken || configuredToken === 'REDACTED') return false

	const actual = request.headers.get('authorization')
	const expected = `Bearer ${configuredToken}`
	if (!actual) return false

	const actualBuffer = Buffer.from(actual)
	const expectedBuffer = Buffer.from(expected)
	return (
		actualBuffer.length === expectedBuffer.length &&
		crypto.timingSafeEqual(actualBuffer, expectedBuffer)
	)
}
