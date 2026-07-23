import { z } from 'zod'

export const UsernameSchema = z
	.string({ required_error: 'Username is required' })
	.min(3, { message: 'Username is too short' })
	.max(20, { message: 'Username is too long' })
	.regex(/^[a-zA-Z0-9_]+$/, {
		message: 'Username can only include letters, numbers, and underscores',
	})
	// users can type the username in any case, but we store it in lowercase
	.transform(value => value.toLowerCase())

export const PasswordSchema = z
	.string({ required_error: 'Password is required' })
	.min(6, { message: 'Password is too short' })
	.max(100, { message: 'Password is too long' })

export const NEW_PASSWORD_REQUIREMENTS = [
	'At least 8 characters',
	'One uppercase letter',
	'One lowercase letter',
	'One number',
	'One symbol',
] as const

export const NewPasswordSchema = z
	.string({ required_error: 'Password is required' })
	.min(8, { message: 'Password must be at least 8 characters' })
	.max(100, { message: 'Password must be 100 characters or fewer' })
	.regex(/[A-Z]/, { message: 'Password must include an uppercase letter' })
	.regex(/[a-z]/, { message: 'Password must include a lowercase letter' })
	.regex(/[0-9]/, { message: 'Password must include a number' })
	.regex(/[^A-Za-z0-9]/, { message: 'Password must include a symbol' })

export const NameSchema = z
	.string({ required_error: 'Name is required' })
	.min(3, { message: 'Name is too short' })
	.max(40, { message: 'Name is too long' })
export const EmailSchema = z
	.string({ required_error: 'Email is required' })
	.email({ message: 'Email is invalid' })
	.min(3, { message: 'Email is too short' })
	.max(100, { message: 'Email is too long' })
	// users can type the email in any case, but we store it in lowercase
	.transform(value => value.toLowerCase())

export const UsernameOrEmailSchema = z.union([EmailSchema, UsernameSchema])

export const PasswordAndConfirmPasswordSchema = z
	.object({ password: NewPasswordSchema, confirmPassword: NewPasswordSchema })
	.superRefine(({ confirmPassword, password }, ctx) => {
		if (confirmPassword !== password) {
			ctx.addIssue({
				path: ['confirmPassword'],
				code: 'custom',
				message: 'The passwords must match',
			})
		}
	})
