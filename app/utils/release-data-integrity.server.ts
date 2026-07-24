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

export const confirmedSeedAccounts = [
	{
		id: '450ab1b9-d297-4fee-8796-e4b8d0996485',
		username: 'ck_aylin_christianse',
		email: 'ck_aylin_christianse@example.com',
		createdAt: '2024-06-22T21:22:02.426Z',
		watchlists: 4,
		trackingStates: 24,
	},
	{
		id: '3cb129ee-a6af-4734-8a88-ec26d1be8310',
		username: 'q6_kody_parisian33',
		email: 'q6_kody_parisian33@example.com',
		createdAt: '2024-06-22T21:22:04.671Z',
		watchlists: 3,
		trackingStates: 17,
	},
	{
		id: 'cbf663a1-fcf8-43b3-be71-6b3e61d0f4e0',
		username: 'vf_velma_kris30',
		email: 'vf_velma_kris30@example.com',
		createdAt: '2024-06-22T21:22:06.288Z',
		watchlists: 2,
		trackingStates: 9,
	},
	{
		id: '4252c1d1-e84f-44ae-b32e-1d29ecd9d0de',
		username: 'am_carmelo_ullrich29',
		email: 'am_carmelo_ullrich29@example.com',
		createdAt: '2024-06-22T21:22:06.956Z',
		watchlists: 5,
		trackingStates: 19,
	},
	{
		id: '7819f13f-6b26-4293-9160-47543433002c',
		username: 'pi_wallace_leuschke2',
		email: 'pi_wallace_leuschke2@example.com',
		createdAt: '2024-06-22T21:22:08.696Z',
		watchlists: 4,
		trackingStates: 13,
	},
	{
		id: 'cmrtt7rkz00033tgguf8fdely',
		username: 'u9_bryana_ebert',
		email: 'u9_bryana_ebert@example.com',
		createdAt: '2026-07-20T22:42:03.492Z',
		watchlists: 0,
		trackingStates: 0,
	},
	{
		id: 'cmrtt7skf0003wms99x8m0cut',
		username: 'jg_arvid_nader23',
		email: 'jg_arvid_nader23@example.com',
		createdAt: '2026-07-20T22:42:04.768Z',
		watchlists: 0,
		trackingStates: 0,
	},
] as const

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

export async function removeConfirmedSeedAccounts(prisma: PrismaClient) {
	return await prisma.$transaction(
		async tx => {
			const expectedById = new Map<
				string,
				(typeof confirmedSeedAccounts)[number]
			>(confirmedSeedAccounts.map(account => [account.id, account]))
			const accounts = await tx.user.findMany({
				where: { id: { in: confirmedSeedAccounts.map(account => account.id) } },
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
					watchlists: {
						select: {
							_count: {
								select: {
									activityEvents: true,
									previousActivityEvents: true,
								},
							},
						},
					},
					trackingStates: {
						select: {
							_count: { select: { activityEvents: true } },
						},
					},
					_count: { select: fixtureAccountCountSelect },
				},
			})

			for (const account of accounts) {
				const expected = expectedById.get(account.id)
				if (!expected) {
					throw new Error(
						`Refusing seed-account cleanup: ${account.id} is not a confirmed seed identity.`,
					)
				}
				const identityMatches =
					account.username === expected.username &&
					account.email === expected.email &&
					account.createdAt.toISOString() === expected.createdAt
				if (!identityMatches) {
					throw new Error(
						`Refusing seed-account cleanup: ${account.id} no longer matches its confirmed seed identity.`,
					)
				}

				const expectedCounts = {
					roles: 1,
					watchlists: expected.watchlists,
					trackingStates: expected.trackingStates,
				}
				const hasOnlyExpectedCounts = Object.entries(account._count).every(
					([name, count]) =>
						count ===
						(expectedCounts[name as keyof typeof expectedCounts] ?? 0),
				)
				const hasOnlyExpectedProfile =
					Boolean(account.password) &&
					!account.image &&
					!account.banner &&
					!account.homeDashboardPreference &&
					!account.notificationPreference &&
					account.roles.length === 1 &&
					account.roles[0]?.name === 'user'
				const hasNoActivity =
					account.watchlists.every(watchlist =>
						Object.values(watchlist._count).every(count => count === 0),
					) &&
					account.trackingStates.every(trackingState =>
						Object.values(trackingState._count).every(count => count === 0),
					)
				if (
					!hasOnlyExpectedCounts ||
					!hasOnlyExpectedProfile ||
					!hasNoActivity
				) {
					throw new Error(
						`Refusing seed-account cleanup: ${account.id} now has non-seed member data.`,
					)
				}
			}

			if (!accounts.length) return { removed: [] as string[] }
			await tx.user.deleteMany({
				where: { id: { in: accounts.map(account => account.id) } },
			})
			return { removed: accounts.map(account => account.id).sort() }
		},
		{ isolationLevel: 'Serializable' },
	)
}
