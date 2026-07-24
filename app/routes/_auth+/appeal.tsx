import {
	getFormProps,
	getInputProps,
	getTextareaProps,
	useForm,
} from '@conform-to/react'
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
import { ErrorList, Field, TextareaField } from '#app/components/forms.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { UsernameOrEmailSchema } from '#app/utils/user-validation.ts'
import { moderationAppealVerificationType } from './appeal.server.ts'
import { prepareVerification } from './verify.server.ts'

const SuspensionAppealSchema = z.object({
	usernameOrEmail: UsernameOrEmailSchema,
	details: z.string().trim().min(10).max(1_000),
})

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	await checkHoneypot(formData)
	const submission = parseWithZod(formData, {
		schema: SuspensionAppealSchema,
	})
	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}
	const { usernameOrEmail, details } = submission.value
	const user = await prisma.user.findFirst({
		where: {
			accountStatus: 'suspended',
			OR: [{ email: usernameOrEmail }, { username: usernameOrEmail }],
		},
		select: { id: true, email: true },
	})
	const decision = user
		? await prisma.moderationAction.findFirst({
				where: { subjectId: user.id, action: 'account_suspend' },
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				select: {
					id: true,
					appeal: { select: { id: true, status: true } },
				},
			})
		: null
	await prisma.moderationAppealDraft.deleteMany({
		where: { expiresAt: { lte: new Date() } },
	})
	const draft =
		user && decision
			? await prisma.moderationAppealDraft.create({
					data: {
						userId: user.id,
						actionId: decision.id,
						details,
						expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
					},
					select: { id: true },
				})
			: null

	const verificationTarget =
		draft?.id ?? `unmatched-appeal-${crypto.randomUUID()}`
	const { verifyUrl, redirectTo, otp } = await prepareVerification({
		period: 15 * 60,
		request,
		type: moderationAppealVerificationType,
		target: verificationTarget,
	})
	if (!user || !draft) return redirect(redirectTo.toString())

	const response = await sendEmail({
		to: user.email,
		subject: 'Verify your Veud moderation appeal',
		react: <ModerationAppealEmail verifyUrl={verifyUrl.toString()} otp={otp} />,
	})
	if (response.status !== 'success') {
		return json(
			{ result: submission.reply({ formErrors: [response.error.message] }) },
			{ status: 500 },
		)
	}
	return redirect(redirectTo.toString())
}

function ModerationAppealEmail({
	verifyUrl,
	otp,
}: {
	verifyUrl: string
	otp: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<E.Heading>Verify your Veud moderation appeal</E.Heading>
				<E.Text>
					Use verification code <strong>{otp}</strong>, or open the link below.
					The code expires in 15 minutes.
				</E.Text>
				<E.Link href={verifyUrl}>{verifyUrl}</E.Link>
				<E.Text>
					If you did not request this appeal, you can ignore this email.
				</E.Text>
			</E.Container>
		</E.Html>
	)
}

export default function SuspensionAppealRoute() {
	const fetcher = useFetcher<typeof action>()
	const [form, fields] = useForm({
		id: 'suspension-appeal',
		constraint: getZodConstraint(SuspensionAppealSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: SuspensionAppealSchema })
		},
		shouldRevalidate: 'onBlur',
	})
	return (
		<AuthShell
			title="Appeal a suspension"
			description="Tell the moderation team what should be reconsidered."
		>
			<fetcher.Form method="post" {...getFormProps(form)} className="space-y-5">
				<HoneypotInputs />
				<Field
					labelProps={{
						htmlFor: fields.usernameOrEmail.id,
						children: 'Username or email',
					}}
					inputProps={{
						...getInputProps(fields.usernameOrEmail, { type: 'text' }),
						autoComplete: 'username',
					}}
					errors={fields.usernameOrEmail.errors}
				/>
				<TextareaField
					labelProps={{
						htmlFor: fields.details.id,
						children: 'Appeal',
					}}
					textareaProps={{
						...getTextareaProps(fields.details),
						rows: 6,
						maxLength: 1_000,
						placeholder: 'Explain the relevant context.',
					}}
					errors={fields.details.errors}
				/>
				<ErrorList errors={form.errors} id={form.errorId} />
				<StatusButton
					type="submit"
					className="w-full"
					status={
						fetcher.state !== 'idle' ? 'pending' : (form.status ?? 'idle')
					}
					disabled={fetcher.state !== 'idle'}
				>
					Email verification code
				</StatusButton>
			</fetcher.Form>
			<Link to="/login" className="mt-6 block text-center text-sm font-bold">
				Back to login
			</Link>
		</AuthShell>
	)
}

export const meta: MetaFunction = () => [
	{ title: 'Appeal a suspension · Veud' },
]
