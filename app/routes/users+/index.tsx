import {
	data as json,
	Form,
	redirect,
	type LoaderFunctionArgs,
	Link,
	useLoaderData,
} from 'react-router'

import { z } from 'zod'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ErrorList } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { cn, getUserImgSrc, useDelayedIsPending } from '#app/utils/misc.tsx'
import { searchUsersByUsername } from '#app/utils/user-search.server.ts'

const UserSearchResultSchema = z.object({
	id: z.string(),
	username: z.string(),
	name: z.string().nullable(),
	imageId: z.string().nullable(),
})

const UserSearchResultsSchema = z.array(UserSearchResultSchema)

export async function loader({ url }: LoaderFunctionArgs) {
	const searchTerm = url.searchParams.get('search')
	if (searchTerm === '') {
		return redirect('/users')
	}

	const rawUsers = await searchUsersByUsername(prisma, searchTerm ?? '')

	const result = UserSearchResultsSchema.safeParse(rawUsers)
	if (!result.success) {
		return json({ status: 'error', error: result.error.message } as const, {
			status: 400,
		})
	}
	return json({
		status: 'idle',
		users: result.data,
		query: searchTerm ?? '',
	} as const)
}

export default function UsersRoute() {
	const data = useLoaderData<typeof loader>()
	const isPending = useDelayedIsPending({
		formMethod: 'GET',
		formAction: '/users',
	})

	if (data.status === 'error') {
		console.error(data.error)
	}

	return (
		<VeudPage width="narrow">
			<VeudPageHeader
				eyebrow="Community"
				title="Members"
				description="Find people to follow."
			/>
			<VeudPanel>
				<Form
					method="get"
					action="/users"
					role="search"
					className="flex flex-col gap-3 sm:flex-row"
				>
					<Input
						name="search"
						type="search"
						defaultValue={data.status === 'idle' ? data.query : ''}
						placeholder="Search usernames"
						aria-label="Search usernames"
						autoFocus
						className="flex-1"
					/>
					<Button type="submit">Search</Button>
				</Form>
			</VeudPanel>
			{data.status === 'idle' ? (
				data.users.length ? (
					<ul
						className={cn(
							'grid gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3',
							{ 'opacity-50': isPending },
						)}
					>
						{data.users.map(user => (
							<li key={user.id}>
								<Link
									to={user.username}
									className="group flex min-h-28 items-center gap-4 rounded-2xl border border-veud-border/70 bg-veud-surface p-4 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-veud-mint"
								>
									<img
										alt=""
										src={getUserImgSrc(user.imageId)}
										className="size-16 rounded-2xl border border-veud-border object-cover"
									/>
									<span className="min-w-0 truncate text-lg font-black text-veud-yellow group-hover:underline">
										@{user.username}
									</span>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<VeudEmptyState title="No members found">
						Try another username.
					</VeudEmptyState>
				)
			) : (
				<ErrorList errors={['Search results could not be loaded.']} />
			)}
		</VeudPage>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
