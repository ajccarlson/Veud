import { redirect } from 'react-router'
import { invariantResponse } from '@epic-web/invariant'
import { prisma } from '#app/utils/db.server.ts'
import { type LoaderFunctionArgs } from 'react-router'

export async function loader({ params }: LoaderFunctionArgs) {
	const currentUser = await prisma.user.findUnique({
		where: {
			username: params['username'] as string,
		},
	})

	invariantResponse(currentUser, 'User not found', { status: 404 })

	const listTypes = await prisma.listType.findMany({
		select: { name: true },
	})
	const preferredNames = ['liveaction', 'anime', 'manga']
	const listTypeData = [...listTypes].sort(
		(first, second) =>
			(preferredNames.indexOf(first.name) === -1
				? Number.MAX_SAFE_INTEGER
				: preferredNames.indexOf(first.name)) -
				(preferredNames.indexOf(second.name) === -1
					? Number.MAX_SAFE_INTEGER
					: preferredNames.indexOf(second.name)) ||
			first.name.localeCompare(second.name),
	)[0]

	invariantResponse(listTypeData, 'List type not found', { status: 404 })

	return redirect(`./${listTypeData.name}`, 303)
}
