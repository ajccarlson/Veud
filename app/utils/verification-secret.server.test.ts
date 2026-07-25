import { afterEach, expect, test, vi } from 'vitest'
import {
	protectVerificationSecret,
	revealVerificationSecret,
} from './verification-secret.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
})

test('protects verification secrets and decrypts them', () => {
	vi.stubEnv('VERIFICATION_SECRET_KEYS', 'active-key')
	const protectedValue = protectVerificationSecret('totp-secret')

	expect(protectedValue).not.toContain('totp-secret')
	expect(protectedValue).toMatch(/^veud:v1:/)
	expect(revealVerificationSecret(protectedValue)).toBe('totp-secret')
})

test('decrypts with retained rotation keys and accepts legacy plaintext', () => {
	vi.stubEnv('VERIFICATION_SECRET_KEYS', 'old-key')
	const protectedValue = protectVerificationSecret('rotated-secret')
	vi.stubEnv('VERIFICATION_SECRET_KEYS', 'new-key,old-key')

	expect(revealVerificationSecret(protectedValue)).toBe('rotated-secret')
	expect(revealVerificationSecret('legacy-plaintext')).toBe('legacy-plaintext')
})
