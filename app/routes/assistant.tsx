import {
	redirect,
	type LoaderFunctionArgs,
	type MetaFunction,
} from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export const meta: MetaFunction = () => [{ title: 'Tracking assistant | Veud' }]

export async function loader({ request }: LoaderFunctionArgs) {
	const ownerId = await requireUserId(request)
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: ownerId },
		select: {
			username: true,
			watchlists: {
				orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
				take: 1,
				select: {
					name: true,
					type: { select: { name: true } },
				},
			},
		},
	})
	const firstWatchlist = user.watchlists[0]
	if (!firstWatchlist) {
		return redirect(`/lists/${encodeURIComponent(user.username)}`)
	}
	return redirect(
		`/lists/${encodeURIComponent(user.username)}/${encodeURIComponent(firstWatchlist.type.name)}/${encodeURIComponent(firstWatchlist.name)}`,
	)
}

export default function AssistantRedirect() {
	return null
}
