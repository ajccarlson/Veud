import { getUserId } from './auth.server.ts'
import { prisma } from './db.server.ts'
import { normalizeTitleLanguage, type TitleLanguage } from './media-title.ts'

/**
 * The title preference of whoever is asking.
 *
 * Signed out this is the default, which is the cost of putting the setting on
 * the member rather than in a cookie: it follows someone between devices, and
 * it cannot follow someone who has not said who they are.
 */
export async function getViewerTitleLanguage(
	request: Request,
): Promise<TitleLanguage> {
	const userId = await getUserId(request)
	if (!userId) return 'default'
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { titleLanguage: true },
	})
	return normalizeTitleLanguage(user?.titleLanguage)
}
