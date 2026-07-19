import { invariantResponse } from '@epic-web/invariant'
import {
	data as json,
	Form,
	Link,
	redirect,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	useActionData,
	useLoaderData,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireCollectionOwner } from '#app/utils/media-collections.server.ts'
import {
	COLLECTION_DESCRIPTION_MAX_LENGTH,
	CollectionDetailsSchema,
	COLLECTION_TITLE_MAX_LENGTH,
} from '#app/utils/media-collections.ts'

const EditActionSchema = z.discriminatedUnion('intent', [
	CollectionDetailsSchema.extend({ intent: z.literal('save') }),
	z.object({ intent: z.literal('delete') }),
])

export async function loader({ request, params }: LoaderFunctionArgs) {
	const owned = await requireCollectionOwner(request, params.collectionId)
	const collection = await prisma.mediaCollection.findUnique({
		where: { id: owned.id },
		select: { id: true, title: true, description: true, isPublic: true },
	})
	invariantResponse(collection, 'Collection not found', { status: 404 })
	return json({ collection })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const owned = await requireCollectionOwner(request, params.collectionId)
	const parsed = EditActionSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return json(
			{ ok: false as const, errors: parsed.error.flatten().fieldErrors },
			{ status: 400 },
		)
	}
	if (parsed.data.intent === 'delete') {
		await prisma.mediaCollection.delete({ where: { id: owned.id } })
		return redirect('/collections', { status: 303 })
	}
	const { intent: _intent, ...details } = parsed.data
	await prisma.mediaCollection.update({
		where: { id: owned.id },
		data: details,
	})
	return redirect(`/collections/${owned.id}`, { status: 303 })
}

export default function EditCollection() {
	const { collection } = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const busy = navigation.state !== 'idle'
	return (
		<main className="mx-auto w-full max-w-3xl space-y-7 px-4 py-8 text-[#ffefcc] sm:px-6">
			<header>
				<p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a2ffd5]">
					Collection settings
				</p>
				<h1 className="mt-2 text-4xl font-black text-[#ff9900]">
					Edit collection
				</h1>
			</header>
			<Form
				method="post"
				className="space-y-6 rounded-2xl border border-[#54806c] bg-[#383040] p-6"
			>
				<input type="hidden" name="intent" value="save" />
				<div className="space-y-2">
					<Label htmlFor="title">Title</Label>
					<Input
						id="title"
						name="title"
						required
						maxLength={COLLECTION_TITLE_MAX_LENGTH}
						defaultValue={collection.title}
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
						defaultValue={collection.description ?? ''}
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
						defaultChecked={collection.isPublic}
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
						{busy ? 'Saving…' : 'Save changes'}
					</Button>
					<Button asChild variant="outline">
						<Link to={`/collections/${collection.id}`}>Cancel</Link>
					</Button>
				</div>
			</Form>
			<section className="rounded-2xl border border-red-400/60 bg-[#383040] p-6">
				<h2 className="text-xl font-black text-red-200">Delete collection</h2>
				<p className="mt-2 text-sm text-[#c6ded2]">
					This removes the curated list, but never deletes media or changes
					tracking data.
				</p>
				<Form method="post" className="mt-4">
					<Button
						type="submit"
						name="intent"
						value="delete"
						variant="destructive"
						disabled={busy}
					>
						Delete permanently
					</Button>
				</Form>
			</section>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
	{
		title: data
			? `Edit ${data.collection.title} · Veud`
			: 'Edit collection · Veud',
	},
]

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{ 404: () => <p>Collection not found.</p> }}
		/>
	)
}
