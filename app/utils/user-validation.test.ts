import { describe, expect, test } from 'vitest'
import {
	NewPasswordSchema,
	PasswordAndConfirmPasswordSchema,
	PasswordSchema,
} from './user-validation.ts'

describe('password validation', () => {
	test('keeps legacy passwords valid for authentication', () => {
		expect(PasswordSchema.safeParse('legacy').success).toBe(true)
	})

	test.each([
		['too short', 'Aa1!abc'],
		['no uppercase letter', 'lowercase1!'],
		['no lowercase letter', 'UPPERCASE1!'],
		['no number', 'NoNumbers!'],
		['no symbol', 'NoSymbols1'],
	])('rejects a new password with %s', (_reason, password) => {
		expect(NewPasswordSchema.safeParse(password).success).toBe(false)
	})

	test('accepts a new password that meets every requirement', () => {
		expect(NewPasswordSchema.safeParse('VeudPass1!').success).toBe(true)
	})

	test('still requires matching confirmation', () => {
		const result = PasswordAndConfirmPasswordSchema.safeParse({
			password: 'VeudPass1!',
			confirmPassword: 'Different1!',
		})
		expect(result.success).toBe(false)
	})
})
