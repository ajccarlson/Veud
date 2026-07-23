import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { parseFormData } from '@remix-run/form-data-parser'
import { useState } from 'react'
import {
	data as json,
	redirect,
	type LoaderFunctionArgs,
	type ActionFunctionArgs,
	Form,
	useActionData,
	useLoaderData,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { ErrorList } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	getUserBannerSrc,
	useDoubleCheck,
	useIsPending,
} from '#app/utils/misc.tsx'
import {
	hasSafeImageSignature,
	isSafeImageContentType,
} from '#app/utils/safe-image.ts'
import { type BreadcrumbHandle } from './profile.tsx'

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon name="camera">Banner</Icon>,
	getSitemapEntries: () => null,
}

const MAX_SIZE = 1024 * 1024 * 5 // 5MB

const DeleteImageSchema = z.object({
	intent: z.literal('delete'),
})

const NewImageSchema = z.object({
	intent: z.literal('submit'),
	bannerFile: z
		.instanceof(File)
		.refine(file => file.size > 0, 'Image is required')
		.refine(file => file.size <= MAX_SIZE, 'Image size must be less than 5MB')
		.refine(
			file => isSafeImageContentType(file.type),
			'Choose a JPEG, PNG, GIF, or WebP image.',
		),
})

const BannerFormSchema = z.discriminatedUnion('intent', [
	DeleteImageSchema,
	NewImageSchema,
])

export async function loader({ request, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			id: true,
			name: true,
			username: true,
			banner: { select: { id: true } },
		},
	})
	invariantResponse(user, 'User not found', { status: 404 })
	return json({ user })
}

export async function action({ request, url }: ActionFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const formData = await parseFormData(request, {
		maxFiles: 1,
		maxFileSize: MAX_SIZE,
		maxParts: 4,
		maxTotalSize: MAX_SIZE + 64 * 1024,
	})

	const submission = await parseWithZod(formData, { schema: BannerFormSchema })

	if (submission.status !== 'success') {
		return json(
			{ result: submission.reply() },
			{ status: submission.status === 'error' ? 400 : 200 },
		)
	}

	if (submission.value.intent === 'delete') {
		await prisma.userBanner.deleteMany({ where: { userId } })
		return redirect('/settings/profile')
	}

	const bannerFile = submission.value.bannerFile
	const blob = Buffer.from(await bannerFile.arrayBuffer())
	if (!hasSafeImageSignature(blob, bannerFile.type)) {
		return json(
			{
				result: submission.reply({
					fieldErrors: {
						bannerFile: ['The file contents do not match a supported image.'],
					},
				}),
			},
			{ status: 400 },
		)
	}

	await prisma.$transaction(async $prisma => {
		await $prisma.userBanner.deleteMany({ where: { userId } })
		await $prisma.user.update({
			where: { id: userId },
			data: {
				banner: {
					create: { contentType: bannerFile.type, blob },
				},
			},
		})
	})

	return redirect('/settings/profile')
}

export default function BannerRoute() {
	const data = useLoaderData<typeof loader>()

	const doubleCheckDeleteImage = useDoubleCheck()

	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()

	const [form, fields] = useForm({
		id: 'profile-banner',
		constraint: getZodConstraint(BannerFormSchema),
		lastResult: actionData?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: BannerFormSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	const isPending = useIsPending()
	const pendingIntent = isPending ? navigation.formData?.get('intent') : null
	const lastSubmissionIntent = fields.intent.value

	const [newImageSrc, setNewImageSrc] = useState<string | null>(null)

	const existingBannerSrc = data.user
		? getUserBannerSrc(data.user.banner?.id)
		: null
	const previewSrc = newImageSrc ?? existingBannerSrc

	return (
		<div>
			<Form
				method="POST"
				encType="multipart/form-data"
				className="flex flex-col items-center justify-center gap-10"
				onReset={() => setNewImageSrc(null)}
				{...getFormProps(form)}
			>
				{previewSrc ? (
					<img
						src={previewSrc}
						className="h-40 w-full max-w-2xl rounded-2xl object-cover"
						alt={data.user?.name ?? data.user?.username}
					/>
				) : (
					<div className="flex h-40 w-full max-w-2xl items-center justify-center rounded-2xl bg-muted text-muted-foreground">
						No banner yet
					</div>
				)}
				<ErrorList
					errors={fields.bannerFile.errors}
					id={fields.bannerFile.id}
				/>
				<div className="flex gap-4">
					{/*
						Same progressive-enhancement approach as the photo form: CSS toggles
						the right buttons based on the file input's "valid" state.
					*/}
					<input
						{...getInputProps(fields.bannerFile, { type: 'file' })}
						accept="image/*"
						className="peer sr-only"
						required
						tabIndex={newImageSrc ? -1 : 0}
						onChange={e => {
							const file = e.currentTarget.files?.[0]
							if (file) {
								const reader = new FileReader()
								reader.onload = event => {
									setNewImageSrc(event.target?.result?.toString() ?? null)
								}
								reader.readAsDataURL(file)
							}
						}}
					/>
					<Button
						asChild
						className="cursor-pointer peer-valid:hidden peer-focus-within:ring-2 peer-focus-visible:ring-2"
					>
						<label htmlFor={fields.bannerFile.id}>
							<Icon name="pencil-1">Change</Icon>
						</label>
					</Button>
					<StatusButton
						name="intent"
						value="submit"
						type="submit"
						className="peer-invalid:hidden"
						status={
							pendingIntent === 'submit'
								? 'pending'
								: lastSubmissionIntent === 'submit'
									? (form.status ?? 'idle')
									: 'idle'
						}
					>
						Save Banner
					</StatusButton>
					<Button
						variant="destructive"
						className="peer-invalid:hidden"
						{...form.reset.getButtonProps()}
					>
						<Icon name="trash">Reset</Icon>
					</Button>
					{data.user.banner?.id ? (
						<StatusButton
							className="peer-valid:hidden"
							variant="destructive"
							{...doubleCheckDeleteImage.getButtonProps({
								type: 'submit',
								name: 'intent',
								value: 'delete',
							})}
							status={
								pendingIntent === 'delete'
									? 'pending'
									: lastSubmissionIntent === 'delete'
										? (form.status ?? 'idle')
										: 'idle'
							}
						>
							<Icon name="trash">
								{doubleCheckDeleteImage.doubleCheck
									? 'Are you sure?'
									: 'Delete'}
							</Icon>
						</StatusButton>
					) : null}
				</div>
				<ErrorList errors={form.errors} />
			</Form>
		</div>
	)
}
