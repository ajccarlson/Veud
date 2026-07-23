import { Html, Link, Text } from 'react-email'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { renderReactEmail, sendEmail } from './email.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('React Email rendering', () => {
	test('produces usable HTML and plain-text verification emails', async () => {
		const verificationUrl = 'https://veud.net/verify?code=123456'
		const { html, text } = await renderReactEmail(
			<Html lang="en">
				<Text>
					Verification code: <strong>123456</strong>
				</Text>
				<Link href={verificationUrl}>Verify your account</Link>
			</Html>,
		)

		expect(html).toContain('<!DOCTYPE html')
		expect(html).toContain('Verification code:')
		expect(html).toContain('123456')
		expect(html).toContain(verificationUrl)
		expect(text).toContain('Verification code: 123456')
		expect(text).toContain('Verify your account')
		expect(text).toContain(verificationUrl)
	})
})

describe('email transport', () => {
	test('fails closed without exposing message contents when delivery is unconfigured', async () => {
		vi.stubEnv('RESEND_API_KEY', '')
		vi.stubEnv('MOCKS', '')
		consoleError.mockImplementation(() => {})
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await sendEmail({
			to: 'member@example.com',
			subject: 'Verification',
			html: '<p>Secret code: 123456</p>',
			text: 'Secret code: 123456',
		})

		expect(result).toEqual({
			status: 'error',
			error: {
				name: 'ConfigurationError',
				message: 'Email delivery is temporarily unavailable.',
				statusCode: 503,
			},
		})
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(consoleError).toHaveBeenCalledWith(
			'Email delivery is unavailable: RESEND_API_KEY is not set.',
		)
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain('123456')
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
			'member@example.com',
		)
	})

	test('normalizes transport failures instead of rejecting the caller', async () => {
		vi.stubEnv('RESEND_API_KEY', 'test-key')
		vi.stubEnv('MOCKS', '')
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('provider connection failed')),
		)

		await expect(
			sendEmail({
				to: 'member@example.com',
				subject: 'Notification',
				html: '<p>Notification</p>',
				text: 'Notification',
			}),
		).resolves.toEqual({
			status: 'error',
			error: {
				name: 'TransportError',
				message: 'Email delivery is temporarily unavailable.',
				statusCode: 503,
			},
		})
	})

	test('returns the provider message identifier on success', async () => {
		vi.stubEnv('RESEND_API_KEY', 'test-key')
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ id: 'provider-message-id' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
			),
		)

		await expect(
			sendEmail({
				to: 'member@example.com',
				subject: 'Notification',
				html: '<p>Notification</p>',
				text: 'Notification',
			}),
		).resolves.toEqual({
			status: 'success',
			data: { id: 'provider-message-id' },
		})
	})
})
