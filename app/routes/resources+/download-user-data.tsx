import { type LoaderFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'

export async function loader({ request, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		// this is one of the *few* instances where you can use "include" because
		// the goal is to literally get *everything*. Normally you should be
		// explicit with "select". We're using select for images because we don't
		// want to send back the entire blob of the image. We'll send a URL they can
		// use to download it instead.
		include: {
			image: {
				select: {
					id: true,
					createdAt: true,
					updatedAt: true,
					contentType: true,
				},
			},
			password: false, // <-- intentionally omit password
			sessions: true,
			roles: true,
			recommendationFeedback: {
				select: {
					id: true,
					mediaId: true,
					feedbackType: true,
					sourceLane: true,
					createdAt: true,
					updatedAt: true,
				},
			},
			homeDashboardPreference: true,
			notificationPreference: true,
			notificationDigests: true,
			moderationReportsSubmitted: {
				select: {
					id: true,
					targetType: true,
					targetId: true,
					reasonCategory: true,
					details: true,
					status: true,
					priority: true,
					resolutionNote: true,
					createdAt: true,
					updatedAt: true,
					resolvedAt: true,
					appealOfActionId: true,
				},
			},
			moderationActionsSubject: {
				select: {
					id: true,
					action: true,
					targetType: true,
					targetId: true,
					reason: true,
					details: true,
					previousStatus: true,
					nextStatus: true,
					createdAt: true,
				},
			},
		},
	})

	const domain = getDomainUrl(request)

	return Response.json(
		{
			user: {
				...user,
				image: user.image
					? {
							...user.image,
							url: `${domain}/resources/user-images/${user.image.id}`,
						}
					: null,
			},
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}
