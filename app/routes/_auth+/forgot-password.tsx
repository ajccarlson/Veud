import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import * as E from 'react-email'
import {
	data as json,
	redirect,
	type ActionFunctionArgs,
	type MetaFunction,
	Link,
	useFetcher,
} from 'react-router'

import { HoneypotInputs } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { AuthShell } from '#app/components/auth-shell.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { UsernameOrEmailSchema } from '#app/utils/user-validation.ts'
import { prepareVerification } from './verify.server.ts'

const ForgotPasswordSchema = z.object({
	usernameOrEmail: UsernameOrEmailSchema,
})

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	await checkHoneypot(formData)
	const submission = parseWithZod(formData, { schema: ForgotPasswordSchema })
	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}
	const { usernameOrEmail } = submission.value

	const user = await prisma.user.findFirst({
		where: { OR: [{ email: usernameOrEmail }, { username: usernameOrEmail }] },
		select: { email: true },
	})

	const { verifyUrl, redirectTo, otp } = await prepareVerification({
		period: 10 * 60,
		request,
		type: 'reset-password',
		target: usernameOrEmail,
	})

	if (!user) {
		return redirect(redirectTo.toString())
	}

	const response = await sendEmail({
		to: user.email,
		subject: `Veud Password Reset`,
		react: (
			<ForgotPasswordEmail onboardingUrl={verifyUrl.toString()} otp={otp} />
		),
	})

	if (response.status !== 'success') {
		return json(
			{ result: submission.reply({ formErrors: [response.error.message] }) },
			{ status: 500 },
		)
	}
	return redirect(redirectTo.toString())
}

function ForgotPasswordEmail({
	onboardingUrl,
	otp,
}: {
	onboardingUrl: string
	otp: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>Veud Password Reset</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or click the link:</E.Text>
				</p>
				<E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
			</E.Container>
		</E.Html>
	)
}

export const meta: MetaFunction = () => {
	return [{ title: 'Password Recovery for Veud' }]
}

export default function ForgotPasswordRoute() {
	const forgotPassword = useFetcher<typeof action>()

	const [form, fields] = useForm({
		id: 'forgot-password-form',
		constraint: getZodConstraint(ForgotPasswordSchema),
		lastResult: forgotPassword.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ForgotPasswordSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<AuthShell
			title="Reset your password"
			description="We’ll email you a verification code."
		>
			<forgotPassword.Form
				method="POST"
				className="space-y-4"
				{...getFormProps(form)}
			>
				<HoneypotInputs />
				<Field
					labelProps={{
						htmlFor: fields.usernameOrEmail.id,
						children: 'Username or email',
					}}
					inputProps={{
						autoFocus: true,
						autoComplete: 'username',
						...getInputProps(fields.usernameOrEmail, { type: 'text' }),
					}}
					errors={fields.usernameOrEmail.errors}
				/>
				<ErrorList errors={form.errors} id={form.errorId} />
				<StatusButton
					className="w-full"
					status={
						forgotPassword.state === 'submitting'
							? 'pending'
							: (form.status ?? 'idle')
					}
					type="submit"
					disabled={forgotPassword.state !== 'idle'}
				>
					Send reset code
				</StatusButton>
			</forgotPassword.Form>
			<Link to="/login" className="mt-6 block text-center text-sm font-bold">
				Back to login
			</Link>
		</AuthShell>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
