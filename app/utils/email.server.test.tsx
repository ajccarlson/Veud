import { Html, Link, Text } from 'react-email'
import { describe, expect, test } from 'vitest'
import { renderReactEmail } from './email.server.ts'

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
