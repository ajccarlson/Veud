import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from 'node:crypto'

const PREFIX = 'veud:v1'

function configuredSecrets() {
	const value =
		process.env.VERIFICATION_SECRET_KEYS?.trim() ||
		process.env.SESSION_SECRET?.trim()
	const secrets = value
		?.split(',')
		.map(secret => secret.trim())
		.filter(Boolean)
	if (!secrets?.length) {
		throw new Error(
			'VERIFICATION_SECRET_KEYS or SESSION_SECRET is required to protect verification secrets.',
		)
	}
	return secrets
}

function keyFor(secret: string) {
	return createHash('sha256')
		.update(`veud:verification-secret:${secret}`, 'utf8')
		.digest()
}

export function protectVerificationSecret(value: string) {
	if (value.startsWith(`${PREFIX}:`)) return value
	const iv = randomBytes(12)
	const cipher = createCipheriv(
		'aes-256-gcm',
		keyFor(configuredSecrets()[0]!),
		iv,
	)
	const ciphertext = Buffer.concat([
		cipher.update(value, 'utf8'),
		cipher.final(),
	])
	const tag = cipher.getAuthTag()
	return [
		PREFIX,
		iv.toString('base64url'),
		tag.toString('base64url'),
		ciphertext.toString('base64url'),
	].join(':')
}

export function revealVerificationSecret(value: string) {
	if (!value.startsWith(`${PREFIX}:`)) return value
	const [prefix, version, encodedIv, encodedTag, encodedCiphertext] =
		value.split(':')
	if (
		`${prefix}:${version}` !== PREFIX ||
		!encodedIv ||
		!encodedTag ||
		!encodedCiphertext
	) {
		throw new Error('Invalid protected verification secret.')
	}
	const iv = Buffer.from(encodedIv, 'base64url')
	const tag = Buffer.from(encodedTag, 'base64url')
	const ciphertext = Buffer.from(encodedCiphertext, 'base64url')

	for (const configuredSecret of configuredSecrets()) {
		try {
			const decipher = createDecipheriv(
				'aes-256-gcm',
				keyFor(configuredSecret),
				iv,
			)
			decipher.setAuthTag(tag)
			return Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]).toString('utf8')
		} catch {
			// Key rotation keeps older keys after the active key.
		}
	}
	throw new Error('Unable to decrypt verification secret with configured keys.')
}
