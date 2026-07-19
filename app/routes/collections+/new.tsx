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
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	COLLECTION_DESCRIPTION_MAX_LENGTH,
	CollectionDetailsSchema,
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
	const collection = await prisma.mediaCollection.create({
		data: { ownerId, ...parsed.data },
		select: { id: true },
	})
	return redirect(`/collections/${collection.id}`, { status: 303 })
}

export default function NewCollection() {
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'
	return (
		<main className="mx-auto w-full max-w-3xl space-y-7 px-4 py-8 text-[#ffefcc] sm:px-6">
			<header className="space-y-2">
				<p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a2ffd5]">
					Curate your catalog
				</p>
				<h1 className="text-4xl font-black text-[#ff9900]">New collection</h1>
				<p className="text-[#c6ded2]">
					Build a ranked list, a themed recommendation set, or anything in
					between.
				</p>
			</header>
			<Form
				method="post"
				className="space-y-6 rounded-2xl border border-[#54806c] bg-[#383040] p-6"
			>
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
						<p className="text-sm text-red-300">{actionData.errors.title[0]}</p>
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
				<div className="flex items-start gap-3 rounded-xl border border-[#54806c] bg-[#2e2f2b] p-4">
					<input
						id="is-public"
						type="checkbox"
						name="isPublic"
						defaultChecked
						className="mt-1 h-4 w-4"
					/>
					<div>
						<Label htmlFor="is-public" className="block text-[#ffffb1]">
							Public collection
						</Label>
						<span className="text-sm text-[#c6ded2]">
							Anyone can discover and share it. Uncheck to keep it visible only
							to you.
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
		</main>
	)
}

export const meta: MetaFunction = () => [{ title: 'New collection · Veud' }]
