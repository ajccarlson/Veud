import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import * as E from 'react-email'
import {
	data as json,
	redirect,
	type ActionFunctionArgs,
	type MetaFunction,
	Form,
	useActionData /*useSearchParams*/,
} from 'react-router'

import { HoneypotInputs } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { AuthShell } from '#app/components/auth-shell.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { ProviderNameSchema } from '#app/utils/connections.tsx'
// import {
// 	ProviderConnectionForm,
// 	providerNames,
// } from '#app/utils/connections.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { EmailSchema } from '#app/utils/user-validation.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { providerNameKey } from './onboarding_.$provider.tsx'
import { prepareVerification } from './verify.server.ts'

const SignupSchema = z.object({
	email: EmailSchema,
})

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()

	await checkHoneypot(formData)

	const submission = await parseWithZod(formData, {
		schema: SignupSchema.superRefine(async (data, ctx) => {
			const existingUser = await prisma.user.findUnique({
				where: { email: data.email },
				select: { id: true },
			})
			if (existingUser) {
				ctx.addIssue({
					path: ['email'],
					code: z.ZodIssueCode.custom,
					message: 'A user already exists with this email',
				})
				return
			}
		}),
		async: true,
	})
	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}
	const { email } = submission.value
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const providerName = ProviderNameSchema.safeParse(
		verifySession.get(providerNameKey),
	)
	const { verifyUrl, redirectTo, otp } = await prepareVerification({
		period: 10 * 60,
		request,
		type: providerName.success ? 'onboarding-provider' : 'onboarding',
		target: email,
	})

	const response = await sendEmail({
		to: email,
		subject: `Welcome to Veud!`,
		react: <SignupEmail onboardingUrl={verifyUrl.toString()} otp={otp} />,
	})

	if (response.status === 'success') {
		return redirect(redirectTo.toString())
	} else {
		return json(
			{
				result: submission.reply({ formErrors: [response.error.message] }),
			},
			{
				status: 500,
			},
		)
	}
}

export function SignupEmail({
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
					<E.Text>Welcome to Veud!</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or click the link to get started:</E.Text>
				</p>
				<E.Link href={onboardingUrl}>{onboardingUrl}</E.Link>
			</E.Container>
		</E.Html>
	)
}

export const meta: MetaFunction = () => {
	return [{ title: 'Sign Up | Veud' }]
}

export default function SignupRoute() {
	const actionData = useActionData<typeof action>()
	const isPending = useIsPending()
	// const [searchParams] = useSearchParams()
	// const redirectTo = searchParams.get('redirectTo')

	const [form, fields] = useForm({
		id: 'signup-form',
		constraint: getZodConstraint(SignupSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			const result = parseWithZod(formData, { schema: SignupSchema })
			return result
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<AuthShell
			title="Start your library"
			description="Enter your email to create an account."
		>
			<Form method="POST" className="space-y-4" {...getFormProps(form)}>
				<HoneypotInputs />
				<Field
					labelProps={{
						htmlFor: fields.email.id,
						children: 'Email',
					}}
					inputProps={{
						...getInputProps(fields.email, { type: 'email' }),
						autoFocus: true,
						autoComplete: 'email',
					}}
					errors={fields.email.errors}
				/>
				<ErrorList errors={form.errors} id={form.errorId} />
				<StatusButton
					className="w-full"
					status={isPending ? 'pending' : (form.status ?? 'idle')}
					type="submit"
					disabled={isPending}
				>
					Continue
				</StatusButton>
			</Form>
			{/* <ul className="mt-5 flex flex-col gap-5 border-b-2 border-t-2 border-border py-3">
					{providerNames.map(providerName => (
						<li key={providerName}>
							<ProviderConnectionForm
								type="Signup"
								providerName={providerName}
								redirectTo={redirectTo}
							/>
						</li>
					))}
				</ul> */}
		</AuthShell>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
