import { type Prisma, type PrismaClient } from '@prisma/client'

export const E2E_MEDIA_TITLE_PREFIX = '[VEUD E2E]'

export const confirmedLeakedMediaFixtures = [
	{
		id: 'cmrtt7flo003uawoits307nqn',
		title: 'Canonical Browser Sequel',
	},
	{
		id: 'cmrtt7fly003vawoia05a4ayj',
		title: 'Hidden Tracked Match',
	},
] as const

export const confirmedFixtureFamily = [
	{
		id: 'cmrtt7fl3003rawoiuyxbbfnm',
		title: 'Recommended Browser Match',
	},
	{
		id: 'cmrtt7fle003sawoigicy9li5',
		title: 'Canonical Media Browser Test',
	},
	...confirmedLeakedMediaFixtures,
	{
		id: 'cmrtt7fm8003wawoinbc3qo61',
		title: 'Unrelated Browser Romance',
	},
] as const

export const confirmedFixtureAccount = {
	id: 'cmrtt7fk6003nawoiux0ubx7q',
	username: '3o_arianna_king72',
	emailDomain: 'example.com',
	createdAt: '2026-07-20T22:41:47.911Z',
	trackingStateId: 'cmrtt7fnk0046awoiqavzz5cg',
	trackedMediaId: 'cmrtt7fle003sawoigicy9li5',
} as const

export const knownTestEmailDomains = [
	'example.com',
	'example.test',
	'test.invalid',
] as const

export const knownMediaFixtureTitles = [
	'Canonical Media Browser Test',
	'Canonical Browser Sequel',
	'Recommended Browser Match',
	'Hidden Tracked Match',
	'Unrelated Browser Romance',
	'Third catalog result',
] as const

const attachmentSelect = {
	entries: true,
	favorites: true,
	trackingStates: true,
	activityEvents: true,
	reviews: true,
	diaryEntries: true,
	collectionItems: true,
	releaseReminders: true,
	recommendationFeedback: true,
	libraryImportItems: true,
} satisfies Prisma.MediaCountOutputTypeSelect

const fixtureAccountCountSelect = {
	watchlists: true,
	userFavorites: true,
	roles: true,
	sessions: true,
	connections: true,
	following: true,
	followers: true,
	commentsAuthored: true,
	profileComments: true,
	trackingStates: true,
	activityEvents: true,
	reviews: true,
	diaryEntries: true,
	reviewLikes: true,
	reviewComments: true,
	notificationsReceived: true,
	notificationsSent: true,
	mediaCollections: true,
	collectionLikes: true,
	collectionComments: true,
	releaseReminders: true,
	catalogQualityReviews: true,
	catalogQualityEvents: true,
	catalogMergesPrepared: true,
	catalogMergesApplied: true,
	catalogMergesReverted: true,
	catalogMergeEvents: true,
	recommendationFeedback: true,
	notificationDigests: true,
	moderationReportsSubmitted: true,
	moderationReportsAssigned: true,
	moderationReportsSubject: true,
	moderationActionsPerformed: true,
	moderationActionsSubject: true,
	moderationAppealDrafts: true,
	serviceIncidentEvents: true,
	libraryImportBatches: true,
	aiDiscoverySessions: true,
	trackingCommandPreviews: true,
} satisfies Prisma.UserCountOutputTypeSelect

export type MemberOwnedMediaAttachments = {
	[K in keyof typeof attachmentSelect]: number
}

export function attachmentTotal(attachments: MemberOwnedMediaAttachments) {
	return Object.values(attachments).reduce((total, count) => total + count, 0)
}

export async function getReleaseDataIntegritySnapshot(prisma: PrismaClient) {
	const fixtureTitles = [
		...knownMediaFixtureTitles,
		...knownMediaFixtureTitles.map(
			title => `${E2E_MEDIA_TITLE_PREFIX} ${title}`,
		),
	]
	const [
		confirmed,
		fixtureFamily,
		providerlessCount,
		providerlessSample,
		...testDomainRows
	] = await Promise.all([
		prisma.media.findMany({
			where: {
				id: { in: confirmedLeakedMediaFixtures.map(item => item.id) },
			},
			orderBy: { id: 'asc' },
			select: {
				id: true,
				title: true,
				kind: true,
				createdAt: true,
				updatedAt: true,
				_count: { select: attachmentSelect },
			},
		}),
		prisma.media.findMany({
			where: {
				OR: [
					{ title: { in: fixtureTitles } },
					{ title: { startsWith: E2E_MEDIA_TITLE_PREFIX } },
				],
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			take: 100,
			select: {
				id: true,
				title: true,
				kind: true,
				createdAt: true,
				_count: { select: attachmentSelect },
			},
		}),
		prisma.media.count({ where: { externalIds: { none: {} } } }),
		prisma.media.findMany({
			where: { externalIds: { none: {} } },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: 25,
			select: {
				id: true,
				title: true,
				kind: true,
				createdAt: true,
				_count: { select: attachmentSelect },
			},
		}),
		...knownTestEmailDomains.map(async domain => {
			const where = { email: { endsWith: `@${domain}` } } as const
			const [count, sample] = await Promise.all([
				prisma.user.count({ where }),
				prisma.user.findMany({
					where,
					orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
					take: 10,
					select: {
						id: true,
						username: true,
						createdAt: true,
					},
				}),
			])
			return { domain, count, sample }
		}),
	])
	return {
		generatedAt: new Date(),
		confirmed: confirmed.map(item => ({
			...item,
			memberAttachmentTotal: attachmentTotal(item._count),
		})),
		fixtureFamily: fixtureFamily.map(item => ({
			...item,
			memberAttachmentTotal: attachmentTotal(item._count),
		})),
		providerless: {
			count: providerlessCount,
			sample: providerlessSample.map(item => ({
				...item,
				memberAttachmentTotal: attachmentTotal(item._count),
			})),
		},
		testEmailDomains: testDomainRows,
	}
}

export async function removeConfirmedTestMediaFixtures(prisma: PrismaClient) {
	return await prisma.$transaction(
		async tx => {
			const rows = await tx.media.findMany({
				where: {
					id: { in: confirmedFixtureFamily.map(item => item.id) },
				},
				select: {
					id: true,
					title: true,
					_count: { select: attachmentSelect },
				},
			})
			const expected = new Map<string, string>(
				confirmedFixtureFamily.map(item => [item.id, item.title]),
			)
			const fixtureAccount = await tx.user.findUnique({
				where: { id: confirmedFixtureAccount.id },
				select: {
					id: true,
					username: true,
					email: true,
					createdAt: true,
					password: { select: { userId: true } },
					image: { select: { id: true } },
					banner: { select: { id: true } },
					homeDashboardPreference: { select: { id: true } },
					notificationPreference: { select: { id: true } },
					roles: { select: { name: true } },
					trackingStates: {
						select: {
							id: true,
							mediaId: true,
							_count: {
								select: {
									entries: true,
									progress: true,
									activityEvents: true,
								},
							},
						},
					},
					_count: { select: fixtureAccountCountSelect },
				},
			})
			if (fixtureAccount) {
				const identityMatches =
					fixtureAccount.username === confirmedFixtureAccount.username &&
					fixtureAccount.email
						.toLowerCase()
						.endsWith(`@${confirmedFixtureAccount.emailDomain}`) &&
					fixtureAccount.createdAt.toISOString() ===
						confirmedFixtureAccount.createdAt
				if (!identityMatches) {
					throw new Error(
						'Refusing fixture cleanup: the exact fixture-account ID no longer matches its confirmed test identity.',
					)
				}
				const trackingState = fixtureAccount.trackingStates[0]
				const hasOnlyExpectedTracking =
					fixtureAccount.trackingStates.length === 1 &&
					trackingState?.id === confirmedFixtureAccount.trackingStateId &&
					trackingState.mediaId === confirmedFixtureAccount.trackedMediaId &&
					Object.values(trackingState._count).every(count => count === 0)
				const expectedCounts = {
					roles: 1,
					trackingStates: 1,
				}
				const hasOnlyExpectedCounts = Object.entries(
					fixtureAccount._count,
				).every(
					([name, count]) =>
						count ===
						(expectedCounts[name as keyof typeof expectedCounts] ?? 0),
				)
				const hasOnlyExpectedProfile =
					Boolean(fixtureAccount.password) &&
					!fixtureAccount.image &&
					!fixtureAccount.banner &&
					!fixtureAccount.homeDashboardPreference &&
					!fixtureAccount.notificationPreference &&
					fixtureAccount.roles.length === 1 &&
					fixtureAccount.roles[0]?.name === 'user'
				if (
					!hasOnlyExpectedTracking ||
					!hasOnlyExpectedCounts ||
					!hasOnlyExpectedProfile
				) {
					throw new Error(
						'Refusing fixture cleanup: the confirmed fixture account now has non-fixture member data.',
					)
				}
			}
			for (const row of rows) {
				if (row.title !== expected.get(row.id)) {
					throw new Error(
						`Refusing to remove ${row.id}: expected fixture title “${expected.get(row.id)}”, found “${row.title ?? 'Untitled'}”.`,
					)
				}
				const total = attachmentTotal(row._count)
				const isExpectedFixtureTracking =
					fixtureAccount &&
					row.id === confirmedFixtureAccount.trackedMediaId &&
					total === 1 &&
					row._count.trackingStates === 1
				if (total && !isExpectedFixtureTracking) {
					throw new Error(
						`Refusing to remove ${row.id}: ${total} member-owned attachment${total === 1 ? '' : 's'} require review.`,
					)
				}
			}
			if (fixtureAccount) {
				await tx.user.delete({ where: { id: fixtureAccount.id } })
			}
			if (!rows.length) {
				return {
					removed: [] as string[],
					removedFixtureAccount: Boolean(fixtureAccount),
				}
			}
			await tx.media.deleteMany({
				where: { id: { in: rows.map(row => row.id) } },
			})
			return {
				removed: rows.map(row => row.id).sort(),
				removedFixtureAccount: Boolean(fixtureAccount),
			}
		},
		{ isolationLevel: 'Serializable' },
	)
}
