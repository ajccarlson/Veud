import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import {
	type ActionFunctionArgs,
	Form,
	useActionData,
	useSearchParams,
} from 'react-router'
import { HoneypotInputs } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { AuthShell } from '#app/components/auth-shell.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { validateRequest } from './verify.server.ts'

export const codeQueryParam = 'code'
export const targetQueryParam = 'target'
export const typeQueryParam = 'type'
export const redirectToQueryParam = 'redirectTo'
const types = [
	'onboarding',
	'onboarding-provider',
	'reset-password',
	'change-email',
	'moderation-appeal',
	'2fa',
] as const
const VerificationTypeSchema = z.enum(types)
export type VerificationTypes = z.infer<typeof VerificationTypeSchema>

export const VerifySchema = z.object({
	[codeQueryParam]: z.string().min(6).max(6),
	[typeQueryParam]: VerificationTypeSchema,
	[targetQueryParam]: z.string(),
	[redirectToQueryParam]: z.string().optional(),
})

export async function action({ request, url }: ActionFunctionArgs) {
	const formData = await request.formData()
	await checkHoneypot(formData)
	return validateRequest(request, url, formData)
}

export default function VerifyRoute() {
	const [searchParams] = useSearchParams()
	const isPending = useIsPending()
	const actionData = useActionData<typeof action>()
	const parseWithZoddType = VerificationTypeSchema.safeParse(
		searchParams.get(typeQueryParam),
	)
	const type = parseWithZoddType.success ? parseWithZoddType.data : null

	const emailHeading = {
		title: 'Check your email',
		description: 'Enter the six-digit code we sent you.',
	}
	const headings: Record<
		VerificationTypes,
		{ title: string; description: string }
	> = {
		onboarding: emailHeading,
		'onboarding-provider': emailHeading,
		'reset-password': emailHeading,
		'change-email': emailHeading,
		'moderation-appeal': {
			title: 'Verify your appeal',
			description: 'Enter the code sent to your account email.',
		},
		'2fa': {
			title: 'Two-factor verification',
			description: 'Enter the code from your authenticator app.',
		},
	}

	const [form, fields] = useForm({
		id: 'verify-form',
		constraint: getZodConstraint(VerifySchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: VerifySchema })
		},
		defaultValue: {
			code: searchParams.get(codeQueryParam),
			type: type,
			target: searchParams.get(targetQueryParam),
			redirectTo: searchParams.get(redirectToQueryParam),
		},
	})

	const heading = type
		? headings[type]
		: {
				title: 'Invalid verification link',
				description: 'Request a new code and try again.',
			}

	return (
		<AuthShell title={heading.title} description={heading.description}>
			<Form method="POST" {...getFormProps(form)} className="space-y-4">
				<HoneypotInputs />
				<ErrorList errors={form.errors} id={form.errorId} />
				<Field
					labelProps={{
						htmlFor: fields[codeQueryParam].id,
						children: 'Verification code',
					}}
					inputProps={{
						...getInputProps(fields[codeQueryParam], { type: 'text' }),
						autoComplete: 'one-time-code',
						inputMode: 'numeric',
						autoFocus: true,
					}}
					errors={fields[codeQueryParam].errors}
				/>
				<input {...getInputProps(fields[typeQueryParam], { type: 'hidden' })} />
				<input
					{...getInputProps(fields[targetQueryParam], { type: 'hidden' })}
				/>
				<input
					{...getInputProps(fields[redirectToQueryParam], {
						type: 'hidden',
					})}
				/>
				<StatusButton
					className="w-full"
					status={isPending ? 'pending' : (form.status ?? 'idle')}
					type="submit"
					disabled={isPending || !type}
				>
					Verify
				</StatusButton>
			</Form>
		</AuthShell>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
