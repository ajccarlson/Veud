import { type Prisma } from '@prisma/client'
import { type LoaderFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getDomainUrl } from '#app/utils/misc.tsx'

/**
 * Every relation on User, and whether a data export carries it.
 *
 * The export promises everything the member has. It previously omitted their
 * lists, entries, reviews and diary, which is a trust problem before it is a
 * feature one, and nothing stopped the next relation going the same way: the
 * include is written by hand and the schema is not consulted.
 *
 * So each relation has to be classified here, and a test compares this ledger
 * against the Prisma schema. Adding a relation to `User` without deciding
 * whether a member's export contains it now fails.
 *
 * Withholding is sometimes the right answer, but it needs a reason:
 *
 * - `credential` — secrets. Exporting them creates a new place to steal from.
 * - `other-members-words` — written by someone else, about or to this member.
 *   Their words are their data, not this member's.
 * - `would-identify-others` — would tell the member who reported, blocked or
 *   muted them, or hand them a list of the members they acted on. An export
 *   must not become a way to find either out. `notificationsSent` is here for
 *   the second reason: every row names a recipient, and moderation records the
 *   moderator as the actor, so exporting it would give anyone who has ever
 *   moderated a roster of everyone they actioned. Nothing is lost by
 *   withholding it — a notification the member caused is a side effect of an
 *   action already exported as their own comment, like or appeal.
 * - `staff-record` — actions this account took while moderating or curating,
 *   which are records about other members rather than personal content.
 */
export const userExportDispositions = {
	image: 'exported',
	banner: 'exported',
	watchlists: 'exported',
	userFavorites: 'exported',
	roles: 'exported',
	sessions: 'exported',
	consents: 'exported',
	connections: 'exported',
	following: 'exported',
	followers: 'exported',
	commentsAuthored: 'exported',
	trackingStates: 'exported',
	consumptionEvents: 'exported',
	activityEvents: 'exported',
	reviews: 'exported',
	diaryEntries: 'exported',
	reviewLikes: 'exported',
	reviewComments: 'exported',
	notificationsReceived: 'exported',
	notificationsSent: 'withheld:would-identify-others',
	mediaCollections: 'exported',
	collectionLikes: 'exported',
	collectionComments: 'exported',
	releaseReminders: 'exported',
	recommendationFeedback: 'exported',
	homeDashboardPreference: 'exported',
	notificationPreference: 'exported',
	notificationDigests: 'exported',
	libraryImportBatches: 'exported',
	aiDiscoverySessions: 'exported',
	trackingCommandPreviews: 'exported',
	safetyControlsOwned: 'exported',
	moderationReportsSubmitted: 'exported',
	moderationActionsSubject: 'exported',
	moderationAppealDrafts: 'exported',

	password: 'withheld:credential',
	twoFactorRecoveryCodes: 'withheld:credential',

	profileComments: 'withheld:other-members-words',

	safetyControlsReceived: 'withheld:would-identify-others',
	moderationReportsSubject: 'withheld:would-identify-others',

	moderationReportsAssigned: 'withheld:staff-record',
	moderationActionsPerformed: 'withheld:staff-record',
	catalogQualityReviews: 'withheld:staff-record',
	catalogQualityEvents: 'withheld:staff-record',
	catalogMergesPrepared: 'withheld:staff-record',
	catalogMergesApplied: 'withheld:staff-record',
	catalogMergesReverted: 'withheld:staff-record',
	catalogMergeEvents: 'withheld:staff-record',
	serviceIncidentEvents: 'withheld:staff-record',
} as const satisfies Record<
	string,
	| 'exported'
	| 'withheld:credential'
	| 'withheld:other-members-words'
	| 'withheld:would-identify-others'
	| 'withheld:staff-record'
>

/** The include this loader runs, exported so the ledger can be checked against it. */
export const userExportInclude = {
	image: {
		select: {
			id: true,
			createdAt: true,
			updatedAt: true,
			contentType: true,
		},
	},
	password: false, // <-- intentionally omit password
	sessions: {
		select: {
			createdAt: true,
			updatedAt: true,
			expirationDate: true,
		},
	},
	banner: {
		select: {
			id: true,
			altText: true,
			contentType: true,
			createdAt: true,
			updatedAt: true,
		},
	},
	roles: true,
	consents: true,
	// Which accounts they signed in with. Provider ids identify the member
	// to that provider and are theirs; nothing here is a secret.
	connections: {
		select: {
			id: true,
			providerName: true,
			providerId: true,
			createdAt: true,
			updatedAt: true,
		},
	},
	// The social graph, both directions. Only the edge and its other end,
	// so this says who they follow and who follows them without carrying
	// anything else about those members.
	following: {
		select: { id: true, followingId: true, createdAt: true },
	},
	followers: {
		select: { id: true, followerId: true, createdAt: true },
	},
	notificationsReceived: {
		select: {
			id: true,
			type: true,
			message: true,
			readAt: true,
			availableAt: true,
			releaseAt: true,
			createdAt: true,
		},
	},
	// Appeals they wrote about their own moderation.
	moderationAppealDrafts: {
		select: {
			id: true,
			details: true,
			actionId: true,
			createdAt: true,
			expiresAt: true,
		},
	},
	// The library and the writing. Their absence was the gap: an export
	// that omits someone's lists, entries and reviews is not the export
	// the page promises, and that is a trust problem before it is a
	// feature one.
	watchlists: {
		include: {
			entries: true,
		},
	},
	userFavorites: true,
	reviews: true,
	diaryEntries: true,
	reviewComments: true,
	reviewLikes: true,
	mediaCollections: {
		include: { items: true },
	},
	collectionComments: true,
	collectionLikes: true,
	releaseReminders: true,
	activityEvents: true,
	// Comments this member WROTE. `commentsAuthored` is the
	// ProfileCommentAuthor side; `profileComments` is ProfileCommentProfile
	// — comments other members wrote *on* this profile, which are their
	// words and must not appear in someone else's export. The first version
	// of this used the wrong side and said in a comment that it did not.
	commentsAuthored: true,
	trackingStates: {
		include: { progress: true },
	},
	consumptionEvents: {
		include: {
			installment: {
				select: {
					id: true,
					kind: true,
					seasonNumber: true,
					number: true,
					absoluteNumber: true,
					title: true,
				},
			},
		},
	},
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
	safetyControlsOwned: {
		select: {
			id: true,
			targetId: true,
			kind: true,
			createdAt: true,
			updatedAt: true,
		},
	},
	homeDashboardPreference: true,
	notificationPreference: true,
	notificationDigests: true,
	libraryImportBatches: {
		include: { items: true },
	},
	aiDiscoverySessions: true,
	trackingCommandPreviews: true,
	// Reports they filed: what they reported, what they wrote about it, and what
	// became of it.
	//
	// `resolutionNote` is not included. It is the note a moderator wrote when
	// closing the report — `terminal ? input.note : null` — and nothing surfaces
	// it to the reporter anywhere in the app, so an export would be the first
	// time they saw it. It concerns the member they reported, or their own
	// conduct in reporting, and neither belongs in a file they can hand to
	// anyone. The same question about `moderationActionsSubject.reason` came out
	// the other way, because that one the member is sent verbatim.
	moderationReportsSubmitted: {
		select: {
			id: true,
			targetType: true,
			targetId: true,
			reasonCategory: true,
			details: true,
			status: true,
			priority: true,
			createdAt: true,
			updatedAt: true,
			resolvedAt: true,
			appealOfActionId: true,
		},
	},
	// What was done to them, and when.
	//
	// `reason` is free text a moderator wrote — `input.note || input.intent` —
	// but for a hide, a warning or a suspension the member has already been sent
	// it verbatim in their notification and it is on their settings page, so
	// withholding it here would remove something they already hold. Triage
	// actions on reports are different: their `reason` is an internal note the
	// member has never seen and it routinely concerns whoever reported them, so
	// only the three action types the member is shown carry it.
	//
	// `details` is never surfaced to the member anywhere and is not exported.
	// Prose cannot have a third party redacted out of it automatically, and an
	// export must not become a way to learn who reported you.
	moderationActionsSubject: {
		select: {
			id: true,
			action: true,
			targetType: true,
			targetId: true,
			previousStatus: true,
			nextStatus: true,
			createdAt: true,
			reason: true,
		},
		where: {
			action: { in: ['hide_content', 'account_warn', 'account_suspend'] },
		},
	},
} satisfies Prisma.UserInclude

export async function loader({ request, url }: LoaderFunctionArgs) {
	const userId = await requireUserId(request, { url })
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		// this is one of the *few* instances where you can use "include" because
		// the goal is to literally get *everything*. Normally you should be
		// explicit with "select". We're using select for images because we don't
		// want to send back the entire blob of the image. We'll send a URL they can
		// use to download it instead.
		include: userExportInclude,
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
				// The banner was listed without one. An export that names an image
				// it gives no way to fetch has not exported it.
				banner: user.banner
					? {
							...user.banner,
							url: `${domain}/resources/user-banners/${user.banner.id}`,
						}
					: null,
			},
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}
