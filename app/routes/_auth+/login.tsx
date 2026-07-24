import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import {
	data as json,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	Form,
	Link,
	useActionData,
	useSearchParams,
} from 'react-router'

import { HoneypotInputs } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { AuthShell } from '#app/components/auth-shell.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { CheckboxField, ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { login, requireAnonymous } from '#app/utils/auth.server.ts'
// import {
// 	ProviderConnectionForm,
// 	providerNames,
// } from '#app/utils/connections.tsx'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import {
	PasswordSchema,
	UsernameOrEmailSchema,
} from '#app/utils/user-validation.ts'
import { handleNewSession } from './login.server.ts'

const LoginFormSchema = z.object({
	usernameOrEmail: UsernameOrEmailSchema,
	password: PasswordSchema,
	redirectTo: z.string().optional(),
	remember: z.boolean().optional(),
})

export async function loader({ request }: LoaderFunctionArgs) {
	await requireAnonymous(request)
	return json({})
}

export async function action({ request }: ActionFunctionArgs) {
	await requireAnonymous(request)
	const formData = await request.formData()
	await checkHoneypot(formData)
	const submission = await parseWithZod(formData, {
		schema: intent =>
			LoginFormSchema.transform(async (data, ctx) => {
				if (intent !== null) return { ...data, session: null }

				const session = await login(data)
				if (!session) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: 'Invalid username, email, or password',
					})
					return z.NEVER
				}

				return { ...data, session }
			}),
		async: true,
	})

	if (submission.status !== 'success' || !submission.value.session) {
		return json(
			{ result: submission.reply({ hideFields: ['password'] }) },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const { session, remember, redirectTo } = submission.value

	return handleNewSession({
		request,
		session,
		remember: remember ?? false,
		redirectTo,
	})
}

export default function LoginPage() {
	const actionData = useActionData<typeof action>()
	const isPending = useIsPending()
	const [searchParams] = useSearchParams()
	const redirectTo = searchParams.get('redirectTo')
	const suspended = searchParams.get('account') === 'suspended'

	const [form, fields] = useForm({
		id: 'login-form',
		constraint: getZodConstraint(LoginFormSchema),
		defaultValue: { redirectTo },
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: LoginFormSchema })
		},
		// Clear a failed-login message while the user edits so the submit button
		// cannot shift between pointer-down and click when the field blurs.
		shouldRevalidate: 'onInput',
	})

	return (
		<AuthShell title="Welcome back" description="Sign in to continue.">
			{suspended ? (
				<p
					role="alert"
					className="mb-5 rounded-xl border border-red-300/50 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-100"
				>
					This account is suspended.{' '}
					<Link to="/appeal" className="underline">
						Submit an appeal
					</Link>
					.
				</p>
			) : null}
			<Form method="POST" className="space-y-4" {...getFormProps(form)}>
				<HoneypotInputs />
				<Field
					labelProps={{ children: 'Username or email' }}
					inputProps={{
						...getInputProps(fields.usernameOrEmail, { type: 'text' }),
						autoFocus: true,
						autoComplete: 'username',
					}}
					errors={fields.usernameOrEmail.errors}
				/>

				<Field
					labelProps={{ children: 'Password' }}
					inputProps={{
						...getInputProps(fields.password, {
							type: 'password',
						}),
						autoComplete: 'current-password',
					}}
					errors={fields.password.errors}
				/>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<CheckboxField
						className="shrink-0"
						labelProps={{
							htmlFor: fields.remember.id,
							children: 'Remember me',
							className: 'whitespace-nowrap',
						}}
						buttonProps={getInputProps(fields.remember, {
							type: 'checkbox',
						})}
						errors={fields.remember.errors}
					/>
					<div className="flex flex-wrap items-center gap-2 text-sm sm:justify-end">
						<Link to="/forgot-password" className="font-semibold">
							Forgot password?
						</Link>
						<span className="text-muted-foreground">·</span>
						<Link to="/appeal" className="font-semibold">
							Appeal suspension
						</Link>
					</div>
				</div>

				<input {...getInputProps(fields.redirectTo, { type: 'hidden' })} />
				<ErrorList errors={form.errors} id={form.errorId} />

				<StatusButton
					className="w-full"
					status={isPending ? 'pending' : (form.status ?? 'idle')}
					type="submit"
					disabled={isPending}
				>
					Log in
				</StatusButton>
			</Form>
			{/* <ul className="mt-5 flex flex-col gap-5 border-b-2 border-t-2 border-border py-3">
							{providerNames.map(providerName => (
								<li key={providerName}>
									<ProviderConnectionForm
										type="Login"
										providerName={providerName}
										redirectTo={redirectTo}
									/>
								</li>
							))}
						</ul> */}
			<div className="flex items-center justify-center gap-2 pt-6 text-sm">
				<span className="text-muted-foreground">New here?</span>
				<Link
					to={
						redirectTo ? `/signup?${encodeURIComponent(redirectTo)}` : '/signup'
					}
					className="font-semibold"
				>
					Create an account
				</Link>
			</div>
		</AuthShell>
	)
}

export const meta: MetaFunction = () => {
	return [{ title: 'Login to Veud' }]
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
