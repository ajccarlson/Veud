import { redirect, type LoaderFunctionArgs } from 'react-router'
import { requireUserId, logout } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

export async function loader({ request, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findUnique({ where: { id: userId } })
	if (!user) {
		const loginParams = new URLSearchParams([
			['redirectTo', `${url.pathname}${url.search}`],
		])
		const redirectTo = `/login?${loginParams}`
		await logout({ request, redirectTo })
		return redirect(redirectTo)
	}
	return redirect(`/users/${user.username}`)
}
