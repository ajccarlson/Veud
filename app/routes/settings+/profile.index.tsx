import {
	getFormProps,
	getInputProps,
	getTextareaProps,
	useForm,
} from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	type LoaderFunctionArgs,
	type ActionFunctionArgs,
	Link,
	useFetcher,
	useLoaderData,
} from 'react-router'
import { z } from 'zod'
import { ErrorList, Field, TextareaField } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	getUserBannerSrc,
	getUserImgSrc,
	useDoubleCheck,
} from '#app/utils/misc.tsx'
import { PROFILE_BIO_MAX_LENGTH } from '#app/utils/profile.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { NameSchema, UsernameSchema } from '#app/utils/user-validation.ts'
import { twoFAVerificationType } from './profile.two-factor.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const ProfileFormSchema = z.object({
	name: NameSchema.optional(),
	username: UsernameSchema,
	bio: z
		.string()
		.trim()
		.max(PROFILE_BIO_MAX_LENGTH, {
			message: `Bio must be ${PROFILE_BIO_MAX_LENGTH} characters or fewer`,
		})
		.optional(),
})

export async function loader({ request, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: {
			id: true,
			name: true,
			username: true,
			bio: true,
			email: true,
			image: {
				select: { id: true },
			},
			banner: {
				select: { id: true },
			},
			_count: {
				select: {
					sessions: {
						where: {
							expirationDate: { gt: new Date() },
						},
					},
				},
			},
		},
	})

	const twoFactorVerification = await prisma.verification.findUnique({
		select: { id: true },
		where: { target_type: { type: twoFAVerificationType, target: userId } },
	})

	const password = await prisma.password.findUnique({
		select: { userId: true },
		where: { userId },
	})

	return json({
		user,
		hasPassword: Boolean(password),
		isTwoFactorEnabled: Boolean(twoFactorVerification),
	})
}

type ProfileActionArgs = {
	request: Request
	userId: string
	formData: FormData
}
const profileUpdateActionIntent = 'update-profile'
const signOutOfSessionsActionIntent = 'sign-out-of-sessions'
const deleteAccountActionIntent = 'delete-account'
const DeleteAccountSchema = z.object({
	confirmation: z.string().trim(),
})

export async function action({ request, url }: ActionFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const formData = await request.formData()
	const intent = formData.get('intent')
	switch (intent) {
		case profileUpdateActionIntent: {
			return profileUpdateAction({ request, userId, formData })
		}
		case signOutOfSessionsActionIntent: {
			return signOutOfSessionsAction({ request, userId, formData })
		}
		case deleteAccountActionIntent: {
			return deleteAccountAction({ request, userId, formData })
		}
		default: {
			throw new Response(`Invalid intent "${intent}"`, { status: 400 })
		}
	}
}

export default function EditUserProfile() {
	const data = useLoaderData<typeof loader>()

	return (
		<div className="flex flex-col gap-12">
			<div className="flex justify-center">
				<div className="relative h-40 w-40 sm:h-52 sm:w-52">
					<img
						src={getUserImgSrc(data.user.image?.id)}
						alt={data.user.username}
						className="h-full w-full rounded-full object-cover"
					/>
					<Button
						asChild
						variant="outline"
						className="absolute -right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full p-0"
					>
						<Link
							preventScrollReset
							to="photo"
							title="Change profile photo"
							aria-label="Change profile photo"
						>
							<Icon name="camera" className="h-4 w-4" />
						</Link>
					</Button>
				</div>
			</div>
			<div className="flex justify-center">
				<div className="relative h-40 w-full max-w-2xl">
					{data.user.banner?.id ? (
						<img
							src={getUserBannerSrc(data.user.banner.id) ?? ''}
							alt={`${data.user.username} banner`}
							className="h-full w-full rounded-2xl object-cover"
						/>
					) : (
						<div className="flex h-full w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground">
							No banner
						</div>
					)}
					<Button
						asChild
						variant="outline"
						className="absolute -right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full p-0"
					>
						<Link
							preventScrollReset
							to="banner"
							title="Change profile banner"
							aria-label="Change profile banner"
						>
							<Icon name="camera" className="h-4 w-4" />
						</Link>
					</Button>
				</div>
			</div>
			<UpdateProfile />

			<div className="my-6 h-1 border-b-[1.5px] border-veud-border" />
			<div className="col-span-full flex flex-col gap-6">
				<div>
					<Link to="change-email">
						<Icon name="envelope-closed">
							Change email from {data.user.email}
						</Icon>
					</Link>
				</div>
				<div>
					<Link to="two-factor">
						{data.isTwoFactorEnabled ? (
							<Icon name="lock-closed">2FA is enabled</Icon>
						) : (
							<Icon name="lock-open-1">Enable 2FA</Icon>
						)}
					</Link>
				</div>
				<div>
					<Link to={data.hasPassword ? 'password' : 'password/create'}>
						<Icon name="dots-horizontal">
							{data.hasPassword ? 'Change Password' : 'Create a Password'}
						</Icon>
					</Link>
				</div>
				{/* <div>
					<Link to="connections">
						<Icon name="link-2">Manage connections</Icon>
					</Link>
				</div> */}
				<div>
					<Link
						reloadDocument
						download="my-epic-notes-data.json"
						to="/resources/download-user-data"
					>
						<Icon name="download">Download your data</Icon>
					</Link>
				</div>
				<SignOutOfSessions />
				<DeleteAccount />
			</div>
		</div>
	)
}

async function profileUpdateAction({ userId, formData }: ProfileActionArgs) {
	const submission = await parseWithZod(formData, {
		async: true,
		schema: ProfileFormSchema.superRefine(async ({ username }, ctx) => {
			const existingUsername = await prisma.user.findUnique({
				where: { username },
				select: { id: true },
			})
			if (existingUsername && existingUsername.id !== userId) {
				ctx.addIssue({
					path: ['username'],
					code: z.ZodIssueCode.custom,
					message: 'A user already exists with this username',
				})
			}
		}),
	})
	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const data = submission.value

	await prisma.user.update({
		select: { username: true },
		where: { id: userId },
		data: {
			name: data.name,
			username: data.username,
			bio: data.bio === undefined ? undefined : data.bio || null,
		},
	})

	return json({
		result: submission.reply(),
	})
}

function UpdateProfile() {
	const data = useLoaderData<typeof loader>()

	const fetcher = useFetcher<typeof profileUpdateAction>()

	const [form, fields] = useForm({
		id: 'edit-profile',
		constraint: getZodConstraint(ProfileFormSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ProfileFormSchema })
		},
		defaultValue: {
			username: data.user.username,
			name: data.user.name,
			bio: data.user.bio,
		},
	})

	return (
		<fetcher.Form method="POST" {...getFormProps(form)}>
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-6 sm:gap-x-10">
				<Field
					className="sm:col-span-3"
					labelProps={{
						htmlFor: fields.username.id,
						children: 'Username',
					}}
					inputProps={getInputProps(fields.username, { type: 'text' })}
					errors={fields.username.errors}
				/>
				<Field
					className="sm:col-span-3"
					labelProps={{ htmlFor: fields.name.id, children: 'Name' }}
					inputProps={getInputProps(fields.name, { type: 'text' })}
					errors={fields.name.errors}
				/>
				<TextareaField
					className="sm:col-span-full"
					labelProps={{
						htmlFor: fields.bio.id,
						children: 'About (Markdown)',
					}}
					textareaProps={{
						...getTextareaProps(fields.bio),
						rows: 8,
						placeholder: 'Tell people a little about yourself…',
					}}
					errors={fields.bio.errors}
				/>
			</div>

			<ErrorList errors={form.errors} id={form.errorId} />

			<div className="mt-8 flex justify-center">
				<StatusButton
					type="submit"
					size="wide"
					name="intent"
					value={profileUpdateActionIntent}
					status={
						fetcher.state !== 'idle' ? 'pending' : (form.status ?? 'idle')
					}
				>
					Save changes
				</StatusButton>
			</div>
		</fetcher.Form>
	)
}

async function signOutOfSessionsAction({ request, userId }: ProfileActionArgs) {
	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const sessionId = authSession.get(sessionKey)
	invariantResponse(
		sessionId,
		'You must be authenticated to sign out of other sessions',
	)
	await prisma.session.deleteMany({
		where: {
			userId,
			id: { not: sessionId },
		},
	})
	return json({ status: 'success' } as const)
}

function SignOutOfSessions() {
	const data = useLoaderData<typeof loader>()
	const dc = useDoubleCheck()

	const fetcher = useFetcher<typeof signOutOfSessionsAction>()
	const otherSessionsCount = data.user._count.sessions - 1
	return (
		<div>
			{otherSessionsCount ? (
				<fetcher.Form method="POST">
					<StatusButton
						{...dc.getButtonProps({
							type: 'submit',
							name: 'intent',
							value: signOutOfSessionsActionIntent,
						})}
						variant={dc.doubleCheck ? 'destructive' : 'default'}
						status={
							fetcher.state !== 'idle'
								? 'pending'
								: (fetcher.data?.status ?? 'idle')
						}
					>
						<Icon name="avatar">
							{dc.doubleCheck
								? `Are you sure?`
								: `Sign out of ${otherSessionsCount} other sessions`}
						</Icon>
					</StatusButton>
				</fetcher.Form>
			) : (
				<Icon name="avatar">This is your only session</Icon>
			)}
		</div>
	)
}

async function deleteAccountAction({
	request,
	userId,
	formData,
}: ProfileActionArgs) {
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { username: true },
	})
	const submission = await parseWithZod(formData, {
		schema: DeleteAccountSchema.superRefine(({ confirmation }, ctx) => {
			if (confirmation !== user.username) {
				ctx.addIssue({
					path: ['confirmation'],
					code: z.ZodIssueCode.custom,
					message: `Enter ${user.username} exactly to confirm`,
				})
			}
		}),
	})
	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	await prisma.user.delete({ where: { id: userId } })
	return redirectWithToast(
		'/',
		{
			type: 'success',
			title: 'Account deleted',
			description: 'Your Veud account and all associated data were deleted.',
		},
		{
			headers: {
				'set-cookie': await authSessionStorage.destroySession(authSession),
			},
		},
	)
}

function DeleteAccount() {
	const data = useLoaderData<typeof loader>()
	const fetcher = useFetcher<typeof deleteAccountAction>()
	const [form, fields] = useForm({
		id: 'delete-account',
		constraint: getZodConstraint(DeleteAccountSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: DeleteAccountSchema })
		},
		shouldRevalidate: 'onBlur',
	})
	return (
		<section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 sm:p-6">
			<div className="max-w-xl">
				<h2 className="text-h5 text-foreground">Delete account</h2>
				<p className="mt-2 text-body-sm text-muted-foreground">
					Permanently delete your profile, lists, activity, reviews, and all
					other account data. This cannot be undone.
				</p>
			</div>
			<fetcher.Form
				method="POST"
				{...getFormProps(form)}
				className="mt-5 max-w-md"
			>
				<Field
					labelProps={{
						htmlFor: fields.confirmation.id,
						children: `Type ${data.user.username} to confirm`,
					}}
					inputProps={{
						...getInputProps(fields.confirmation, { type: 'text' }),
						autoComplete: 'off',
					}}
					errors={fields.confirmation.errors}
				/>
				<ErrorList errors={form.errors} id={form.errorId} />
				<StatusButton
					type="submit"
					name="intent"
					value={deleteAccountActionIntent}
					variant="destructive"
					status={
						fetcher.state !== 'idle' ? 'pending' : (form.status ?? 'idle')
					}
					disabled={fetcher.state !== 'idle'}
				>
					<Icon name="trash">Permanently delete account</Icon>
				</StatusButton>
			</fetcher.Form>
		</section>
	)
}
