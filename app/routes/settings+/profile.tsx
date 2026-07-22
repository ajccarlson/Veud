import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	type LoaderFunctionArgs,
	Link,
	Outlet,
	useMatches,
} from 'react-router'

import { z } from 'zod'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { useUser } from '#app/utils/user.ts'

export const BreadcrumbHandle = z.object({ breadcrumb: z.any() })
export type BreadcrumbHandle = z.infer<typeof BreadcrumbHandle>

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon name="file-text">Edit Profile</Icon>,
	getSitemapEntries: () => null,
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { username: true },
	})
	invariantResponse(user, 'User not found', { status: 404 })
	return json({})
}

const BreadcrumbHandleMatch = z.object({
	handle: BreadcrumbHandle,
})

export default function EditUserProfile() {
	const user = useUser()
	const matches = useMatches()
	const breadcrumbs = matches
		.map(m => {
			const result = BreadcrumbHandleMatch.safeParse(m)
			if (!result.success || !result.data.handle.breadcrumb) return null
			return (
				<Link key={m.id} to={m.pathname} className="flex items-center">
					{result.data.handle.breadcrumb}
				</Link>
			)
		})
		.filter(Boolean)

	return (
		<VeudPage width="form" className="mb-16 sm:mb-24">
			<nav aria-label="Profile settings breadcrumb">
				<ul className="flex flex-wrap items-center gap-3 text-sm">
					<li>
						<Link
							className="text-veud-mint transition hover:text-veud-cream"
							to={`/users/${user.username}`}
						>
							Profile
						</Link>
					</li>
					{breadcrumbs.map((breadcrumb, i, arr) => (
						<li
							key={i}
							className={cn('flex items-center gap-3', {
								'text-veud-copy': i < arr.length - 1,
							})}
						>
							| {breadcrumb}
						</li>
					))}
				</ul>
			</nav>
			<VeudPageHeader
				eyebrow="Account"
				title="Edit profile"
				description="Manage how you appear across Veud and keep your account secure."
			/>
			<VeudPanel className="p-5 sm:p-8">
				<Outlet />
			</VeudPanel>
		</VeudPage>
	)
}
