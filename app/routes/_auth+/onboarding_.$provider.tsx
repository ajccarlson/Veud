import {
	getFormProps,
	getInputProps,
	useForm,
	type SubmissionResult,
} from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import {
	redirect,
	data as json,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	type Params,
	Form,
	useActionData,
	useLoaderData,
	useSearchParams,
} from 'react-router'

import { safeRedirect } from 'remix-utils/safe-redirect'
import { z } from 'zod'
import { AuthShell } from '#app/components/auth-shell.tsx'
import { CheckboxField, ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	sessionKey,
	signupWithConnection,
	requireAnonymous,
} from '#app/utils/auth.server.ts'
import { ProviderNameSchema } from '#app/utils/connections.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import {
	OptionalNameSchema,
	UsernameSchema,
} from '#app/utils/user-validation.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { onboardingEmailSessionKey } from './onboarding'

export const providerIdKey = 'providerId'
export const providerNameKey = 'providerName'
export const prefilledProfileKey = 'prefilledProfile'

const SignupFormSchema = z.object({
	imageUrl: z.string().optional(),
	username: UsernameSchema,
	name: OptionalNameSchema,
	agreeToTermsOfServiceAndPrivacyPolicy: z.boolean({
		required_error: 'You must agree to the terms of service and privacy policy',
	}),
	remember: z.boolean().optional(),
	redirectTo: z.string().optional(),
})

async function requireData({
	request,
	params,
}: {
	request: Request
	params: Params
}) {
	await requireAnonymous(request)
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const email = verifySession.get(onboardingEmailSessionKey)
	const providerId = verifySession.get(providerIdKey)
	const providerName = verifySession.get(providerNameKey)
	const result = z
		.object({
			email: z.string(),
			providerName: ProviderNameSchema,
			providerId: z.string(),
		})
		.safeParse({ email, providerName, providerId })
	if (!result.success) {
		console.error('[oauth] onboarding connection failed', {
			providerName,
			errorName:
				result.error instanceof Error ? result.error.name : typeof result.error,
		})
		throw redirect('/signup')
	}
	if (result.data.providerName !== params.provider) throw redirect('/signup')
	return result.data
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { email } = await requireData({ request, params })
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const prefilledProfile = verifySession.get(prefilledProfileKey)

	return json({
		email,
		status: 'idle',
		submission: {
			status: 'error',
			initialValue: prefilledProfile ?? {},
			error: {
				'': [],
			},
		} as SubmissionResult,
	})
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { email, providerId, providerName } = await requireData({
		request,
		params,
	})
	const formData = await request.formData()
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)

	const submission = await parseWithZod(formData, {
		schema: SignupFormSchema.superRefine(async (data, ctx) => {
			const existingUser = await prisma.user.findUnique({
				where: { username: data.username },
				select: { id: true },
			})
			if (existingUser) {
				ctx.addIssue({
					path: ['username'],
					code: z.ZodIssueCode.custom,
					message: 'A user already exists with this username',
				})
				return
			}
		}).transform(async data => {
			const session = await signupWithConnection({
				...data,
				name: data.name ?? null,
				email,
				providerId,
				providerName,
			})
			return { ...data, session }
		}),
		async: true,
	})

	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const { session, remember, redirectTo } = submission.value

	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	authSession.set(sessionKey, session.id)
	const headers = new Headers()
	headers.append(
		'set-cookie',
		await authSessionStorage.commitSession(authSession, {
			expires: remember ? session.expirationDate : undefined,
		}),
	)
	headers.append(
		'set-cookie',
		await verifySessionStorage.destroySession(verifySession),
	)

	return redirectWithToast(
		safeRedirect(redirectTo),
		{ title: 'Welcome', description: 'Thanks for signing up!' },
		{ headers },
	)
}

export const meta: MetaFunction = () => {
	return [{ title: 'Setup Veud Account' }]
}

export default function SignupRoute() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const isPending = useIsPending()
	const [searchParams] = useSearchParams()
	const redirectTo = searchParams.get('redirectTo')

	const [form, fields] = useForm({
		id: 'onboarding-provider-form',
		constraint: getZodConstraint(SignupFormSchema),
		lastResult: actionData?.result ?? data.submission,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: SignupFormSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<AuthShell
			title="Finish your account"
			description={`Connected as ${data.email}.`}
		>
			<Form method="POST" className="space-y-4" {...getFormProps(form)}>
				{fields.imageUrl.initialValue ? (
					<div className="flex items-center gap-4 rounded-xl border border-veud-border/60 bg-veud-ink/50 p-3">
						<img
							src={fields.imageUrl.initialValue}
							alt=""
							className="h-16 w-16 rounded-xl object-cover"
						/>
						<p className="text-sm text-veud-copy">Imported profile photo</p>
						<input {...getInputProps(fields.imageUrl, { type: 'hidden' })} />
					</div>
				) : null}
				<Field
					labelProps={{ htmlFor: fields.username.id, children: 'Username' }}
					inputProps={{
						...getInputProps(fields.username, { type: 'text' }),
						autoComplete: 'username',
						className: 'lowercase',
					}}
					errors={fields.username.errors}
				/>
				<Field
					labelProps={{
						htmlFor: fields.name.id,
						children: 'Full name (private and optional)',
					}}
					inputProps={{
						...getInputProps(fields.name, { type: 'text' }),
						autoComplete: 'name',
					}}
					errors={fields.name.errors}
				/>

				<CheckboxField
					labelProps={{
						htmlFor: fields.agreeToTermsOfServiceAndPrivacyPolicy.id,
						children: 'I agree to the Terms of Service and Privacy Policy.',
					}}
					buttonProps={getInputProps(
						fields.agreeToTermsOfServiceAndPrivacyPolicy,
						{ type: 'checkbox' },
					)}
					errors={fields.agreeToTermsOfServiceAndPrivacyPolicy.errors}
				/>
				<CheckboxField
					labelProps={{
						htmlFor: fields.remember.id,
						children: 'Remember me',
					}}
					buttonProps={getInputProps(fields.remember, { type: 'checkbox' })}
					errors={fields.remember.errors}
				/>

				{redirectTo ? (
					<input type="hidden" name="redirectTo" value={redirectTo} />
				) : null}

				<ErrorList errors={form.errors} id={form.errorId} />

				<StatusButton
					className="w-full"
					status={isPending ? 'pending' : (form.status ?? 'idle')}
					type="submit"
					disabled={isPending}
				>
					Create account
				</StatusButton>
			</Form>
		</AuthShell>
	)
}
