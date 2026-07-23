import { type ReactElement } from 'react'
import { render } from 'react-email'
import { z } from 'zod'

const resendErrorSchema = z.union([
	z.object({
		name: z.string(),
		message: z.string(),
		statusCode: z.number(),
	}),
	z.object({
		name: z.literal('UnknownError'),
		message: z.literal('Unknown Error'),
		statusCode: z.literal(500),
		cause: z.any(),
	}),
])
type ResendError = z.infer<typeof resendErrorSchema>

const resendSuccessSchema = z.object({
	id: z.string(),
})

export async function sendEmail({
	react,
	...options
}: {
	to: string
	subject: string
} & (
	| { html: string; text: string; react?: never }
	| { react: ReactElement; html?: never; text?: never }
)) {
	const from = 'onboarding@veud.net'

	const email = {
		from,
		...options,
		...(react ? await renderReactEmail(react) : null),
	}

	if (!process.env.RESEND_API_KEY && !process.env.MOCKS) {
		console.error('Email delivery is unavailable: RESEND_API_KEY is not set.')
		return {
			status: 'error',
			error: {
				name: 'ConfigurationError',
				message: 'Email delivery is temporarily unavailable.',
				statusCode: 503,
			},
		} as const
	}

	let response: Response
	let data: unknown
	try {
		response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		body: JSON.stringify(email),
		headers: {
			Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
			'Content-Type': 'application/json',
		},
	})
		data = await response.json()
	} catch {
		return {
			status: 'error',
			error: {
				name: 'TransportError',
				message: 'Email delivery is temporarily unavailable.',
				statusCode: 503,
			},
		} as const
	}
	const parsedData = resendSuccessSchema.safeParse(data)

	if (response.ok && parsedData.success) {
		return {
			status: 'success',
			data: parsedData.data,
		} as const
	} else {
		const parseResult = resendErrorSchema.safeParse(data)
		if (parseResult.success) {
			return {
				status: 'error',
				error: parseResult.data,
			} as const
		} else {
			return {
				status: 'error',
				error: {
					name: 'UnknownError',
					message: 'Unknown Error',
					statusCode: 500,
					cause: data,
				} satisfies ResendError,
			} as const
		}
	}
}

export async function renderReactEmail(react: ReactElement) {
	const [html, text] = await Promise.all([
		render(react),
		render(react, { plainText: true }),
	])
	return { html, text }
}
