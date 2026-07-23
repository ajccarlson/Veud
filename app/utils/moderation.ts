export const moderationTargetTypes = [
	'account',
	'review',
	'review_comment',
	'collection',
	'collection_comment',
	'profile_comment',
] as const

export type ModerationTargetType = (typeof moderationTargetTypes)[number]

export const reportableModerationReasons = [
	'spam',
	'harassment',
	'hate_or_abuse',
	'sexual_content',
	'violence_or_threat',
	'impersonation',
	'privacy',
	'spoiler',
	'off_topic',
	'other',
] as const

export const moderationReasons = [
	...reportableModerationReasons,
	'appeal',
] as const

export type ModerationReason = (typeof moderationReasons)[number]

export const moderationReasonLabels: Record<ModerationReason, string> = {
	spam: 'Spam or manipulation',
	harassment: 'Harassment',
	hate_or_abuse: 'Hate or abusive conduct',
	sexual_content: 'Sexual content',
	violence_or_threat: 'Violence or credible threat',
	impersonation: 'Impersonation',
	privacy: 'Private information',
	spoiler: 'Unmarked spoiler',
	off_topic: 'Off-topic or disruptive',
	appeal: 'Appeal a moderation decision',
	other: 'Something else',
}

export const moderationTargetLabels: Record<ModerationTargetType, string> = {
	account: 'Member account',
	review: 'Review',
	review_comment: 'Review comment',
	collection: 'Collection',
	collection_comment: 'Collection comment',
	profile_comment: 'Profile comment',
}

export function isModerationTargetType(
	value: string,
): value is ModerationTargetType {
	return moderationTargetTypes.includes(value as ModerationTargetType)
}

export function moderationTargetHref(
	targetType: ModerationTargetType,
	targetId: string,
	context?: {
		mediaId?: string | null
		collectionId?: string | null
		username?: string | null
	},
) {
	if (targetType === 'account' && context?.username) {
		return `/users/${context.username}`
	}
	if (targetType === 'collection') return `/collections/${targetId}`
	if (targetType === 'collection_comment' && context?.collectionId) {
		return `/collections/${context.collectionId}#collection-comment-${targetId}`
	}
	if (targetType === 'review' && context?.mediaId) {
		return `/media/${context.mediaId}#review-${targetId}`
	}
	if (targetType === 'review_comment' && context?.mediaId) {
		return `/media/${context.mediaId}#comment-${targetId}`
	}
	return null
}
