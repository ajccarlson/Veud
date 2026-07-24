import {
	data as json,
	Form,
	Link,
	redirect,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useActionData,
	useNavigation,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { collectionTagCreateData } from '#app/utils/media-collections.server.ts'
import {
	COLLECTION_DESCRIPTION_MAX_LENGTH,
	CollectionDetailsSchema,
	COLLECTION_TAG_INPUT_MAX_LENGTH,
	COLLECTION_TAG_MAX_COUNT,
	COLLECTION_TITLE_MAX_LENGTH,
} from '#app/utils/media-collections.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	await requireUserId(request)
	return null
}

export async function action({ request }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const formData = await request.formData()
	const parsed = CollectionDetailsSchema.safeParse(Object.fromEntries(formData))
	if (!parsed.success) {
		return json(
			{ ok: false as const, errors: parsed.error.flatten().fieldErrors },
			{ status: 400 },
		)
	}
	const { tags, ...details } = parsed.data
	const collection = await prisma.mediaCollection.create({
		data: {
			ownerId,
			...details,
			tags: { create: collectionTagCreateData(tags) },
		},
		select: { id: true },
	})
	return redirect(`/collections/${collection.id}`, { status: 303 })
}

export default function NewCollection() {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'
	return (
		<VeudPage width="form">
			<VeudPageHeader
				eyebrow="Curate your catalog"
				title="New collection"
				description="Build a ranked list, a themed recommendation set, or anything in between."
			/>
			<VeudPanel className="p-5 sm:p-7">
				<Form method="post" className="space-y-6">
					<div className="space-y-2">
						<Label htmlFor="title">Title</Label>
						<Input
							id="title"
							name="title"
							required
							maxLength={COLLECTION_TITLE_MAX_LENGTH}
							autoFocus
						/>
						{actionData?.errors.title?.[0] ? (
							<p className="text-sm text-red-300">
								{actionData.errors.title[0]}
							</p>
						) : null}
					</div>
					<div className="space-y-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							name="description"
							maxLength={COLLECTION_DESCRIPTION_MAX_LENGTH}
							rows={7}
							placeholder="What connects these titles?"
						/>
						{actionData?.errors.description?.[0] ? (
							<p className="text-sm text-red-300">
								{actionData.errors.description[0]}
							</p>
						) : null}
					</div>
					<div className="space-y-2">
						<Label htmlFor="tags">Tags</Label>
						<Input
							id="tags"
							name="tags"
							maxLength={COLLECTION_TAG_INPUT_MAX_LENGTH}
							placeholder="science fiction, comfort watches, 1990s"
						/>
						<p className="text-xs font-semibold text-veud-mint">
							Up to {COLLECTION_TAG_MAX_COUNT} comma-separated discovery tags.
						</p>
						{actionData?.errors.tags?.[0] ? (
							<p className="text-sm text-red-300">
								{actionData.errors.tags[0]}
							</p>
						) : null}
					</div>
					<div className="flex items-start gap-3 rounded-xl border border-veud-border/70 bg-veud-ink/75 p-4">
						<input
							id="is-public"
							type="checkbox"
							name="isPublic"
							defaultChecked
							className="mt-1 h-4 w-4"
						/>
						<div>
							<Label htmlFor="is-public" className="block text-veud-yellow">
								Public collection
							</Label>
							<span className="text-sm leading-6 text-veud-copy">
								Anyone can discover and share it. Uncheck to keep it visible
								only to you.
							</span>
						</div>
					</div>
					<div className="flex flex-wrap gap-3">
						<Button type="submit" disabled={busy}>
							{busy ? 'Creating…' : 'Create collection'}
						</Button>
						<Button asChild variant="outline">
							<Link to="/collections">Cancel</Link>
						</Button>
					</div>
				</Form>
			</VeudPanel>
		</VeudPage>
	)
}

export const meta: MetaFunction = () => [{ title: 'New collection · Veud' }]
