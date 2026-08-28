import { Prisma } from '@prisma/client'
import { describe, expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	attachmentTotal,
	fixtureAccountCountSelectForTest,
	mediaAttachmentOwnershipForTest,
	mediaAttachmentRelations,
	seedRowActivityOwnership,
	trackingStateActivitySelect,
	watchlistActivitySelect,
	confirmedFixtureAccount,
	confirmedFixtureFamily,
	confirmedLeakedMediaFixtures,
	confirmedSeedAccounts,
	E2E_MEDIA_TITLE_PREFIX,
	knownMediaFixtureTitles,
	removeConfirmedSeedAccounts,
	removeConfirmedTestMediaFixtures,
} from './release-data-integrity.server.ts'

describe('release data integrity', () => {
	test('keeps a reserved browser-fixture marker and exact leaked identities', () => {
		expect(E2E_MEDIA_TITLE_PREFIX).toBe('[VEUD E2E]')
		expect(confirmedLeakedMediaFixtures).toEqual([
			{
				id: 'cmrtt7flo003uawoits307nqn',
				title: 'Canonical Browser Sequel',
			},
			{
				id: 'cmrtt7fly003vawoia05a4ayj',
				title: 'Hidden Tracked Match',
			},
		])
		expect(knownMediaFixtureTitles).toContain('Third catalog result')
		expect(confirmedFixtureFamily).toHaveLength(5)
		expect(confirmedFixtureFamily.map(item => item.id)).toContain(
			confirmedFixtureAccount.trackedMediaId,
		)
		expect(confirmedFixtureAccount.emailDomain).toBe('example.com')
		expect(confirmedSeedAccounts).toHaveLength(7)
		expect(
			confirmedSeedAccounts.every(
				account => account.email === `${account.username}@example.com`,
			),
		).toBe(true)
		expect(
			confirmedSeedAccounts.filter(account => account.imageId).length,
		).toBe(5)
	})

	test('removes only exact isolated seed-account identities', async () => {
		const role = await prisma.role.upsert({
			where: { name: 'user' },
			update: {},
			create: { name: 'user', description: 'Member' },
		})
		const isolatedAccounts = confirmedSeedAccounts.filter(
			account => account.watchlists === 0 && account.trackingStates === 0,
		)
		await prisma.user.createMany({
			data: isolatedAccounts.map(account => ({
				id: account.id,
				username: account.username,
				email: account.email,
				createdAt: new Date(account.createdAt),
				updatedAt: new Date(account.createdAt),
			})),
		})
		for (const account of isolatedAccounts) {
			await prisma.user.update({
				where: { id: account.id },
				data: {
					password: { create: { hash: 'test-only' } },
					roles: { connect: { id: role.id } },
				},
			})
		}

		await expect(removeConfirmedSeedAccounts(prisma)).resolves.toEqual({
			removed: isolatedAccounts.map(account => account.id).sort(),
		})
		expect(
			await prisma.user.count({
				where: { id: { in: isolatedAccounts.map(account => account.id) } },
			}),
		).toBe(0)
	})

	test('refuses seed-account cleanup after community activity', async () => {
		const role = await prisma.role.upsert({
			where: { name: 'user' },
			update: {},
			create: { name: 'user', description: 'Member' },
		})
		const account = confirmedSeedAccounts.find(
			candidate => candidate.watchlists === 0 && candidate.trackingStates === 0,
		)!
		const media = await prisma.media.create({
			data: { kind: 'movie', title: 'Seed cleanup refusal test' },
		})
		await prisma.user.create({
			data: {
				id: account.id,
				username: account.username,
				email: account.email,
				createdAt: new Date(account.createdAt),
				updatedAt: new Date(account.createdAt),
				password: { create: { hash: 'test-only' } },
				roles: { connect: { id: role.id } },
				reviews: {
					create: {
						mediaId: media.id,
						body: 'Community activity must make account cleanup fail closed.',
					},
				},
			},
		})

		await expect(removeConfirmedSeedAccounts(prisma)).rejects.toThrow(
			'now has non-seed member data',
		)
		expect(await prisma.user.count({ where: { id: account.id } })).toBe(1)
	})

	test('counts every member-owned attachment category', () => {
		expect(
			attachmentTotal({
				entries: 1,
				favorites: 2,
				trackingStates: 3,
				activityEvents: 4,
				reviews: 5,
				diaryEntries: 6,
				collectionItems: 7,
				releaseReminders: 8,
				recommendationFeedback: 9,
				libraryImportItems: 10,
			}),
		).toBe(55)
	})

	test('removes only the exact isolated fixture family and account shape', async () => {
		const role = await prisma.role.upsert({
			where: { name: 'user' },
			update: {},
			create: { name: 'user', description: 'Member' },
		})
		await prisma.media.createMany({
			data: confirmedFixtureFamily.map(item => ({
				...item,
				kind: 'anime',
				createdAt: new Date('2026-07-20T22:41:47.944Z'),
				updatedAt: new Date('2026-07-20T22:41:47.944Z'),
			})),
		})
		await prisma.user.create({
			data: {
				id: confirmedFixtureAccount.id,
				username: confirmedFixtureAccount.username,
				email: `${confirmedFixtureAccount.username}@${confirmedFixtureAccount.emailDomain}`,
				createdAt: new Date(confirmedFixtureAccount.createdAt),
				updatedAt: new Date(confirmedFixtureAccount.createdAt),
				password: { create: { hash: 'test-only' } },
				roles: { connect: { id: role.id } },
				trackingStates: {
					create: {
						id: confirmedFixtureAccount.trackingStateId,
						mediaId: confirmedFixtureAccount.trackedMediaId,
						status: 'watching',
					},
				},
			},
		})

		await expect(removeConfirmedTestMediaFixtures(prisma)).resolves.toEqual({
			removed: confirmedFixtureFamily.map(item => item.id).sort(),
			removedFixtureAccount: true,
		})
		expect(
			await prisma.media.count({
				where: { id: { in: confirmedFixtureFamily.map(item => item.id) } },
			}),
		).toBe(0)
		expect(
			await prisma.user.count({ where: { id: confirmedFixtureAccount.id } }),
		).toBe(0)
	})

	test('refuses cleanup when a fixture has unexpected member history', async () => {
		const media = confirmedFixtureFamily[0]
		await prisma.media.create({
			data: { ...media, kind: 'anime' },
		})
		const member = await prisma.user.create({
			data: {
				username: 'real_member_fixture_guard',
				email: 'real_member_fixture_guard@member.invalid',
			},
		})
		await prisma.review.create({
			data: {
				authorId: member.id,
				mediaId: media.id,
				body: 'A member-owned review must make fixture cleanup fail closed.',
			},
		})

		await expect(removeConfirmedTestMediaFixtures(prisma)).rejects.toThrow(
			'member-owned attachment',
		)
		expect(await prisma.media.count({ where: { id: media.id } })).toBe(1)
		expect(await prisma.review.count({ where: { mediaId: media.id } })).toBe(1)
	})
})

test('every Media relation is classified before a fixture can be removed', async () => {
	// This gates a delete. A relation missing from the count is a relation whose
	// rows protect nothing — consumptionEvents, a member's watch and read log,
	// was missing, so a fixture nobody had listed but had watched counted as
	// unattached and went, taking the log with it.
	const { Prisma } = await import('@prisma/client')
	const media = Prisma.dmmf.datamodel.models.find(
		model => model.name === 'Media',
	)
	const relations = media!.fields
		.filter(field => field.kind === 'object' && field.isList)
		.map(field => field.name)
		.sort()

	expect(relations).toEqual(Object.keys(mediaAttachmentOwnershipForTest).sort())
})

test('a members watch log keeps a fixture from being removed', () => {
	expect(mediaAttachmentRelations).toContain('consumptionEvents')
	// And the catalog rows every fixture has by construction do not, or nothing
	// would ever be removable.
	for (const name of ['titles', 'externalIds', 'credits', 'catalogFeedItems']) {
		expect(mediaAttachmentRelations).not.toContain(name)
	}
})

test('an account counts every relation it has', async () => {
	// The hand-written list had drifted to 39 of 44, missing consumptionEvents,
	// consents, twoFactorRecoveryCodes and both safety-control relations. An
	// account holding only those counted as inert.
	const { Prisma } = await import('@prisma/client')
	const user = Prisma.dmmf.datamodel.models.find(model => model.name === 'User')
	const relations = user!.fields
		.filter(field => field.kind === 'object' && field.isList)
		.map(field => field.name)
		.sort()

	expect(Object.keys(fixtureAccountCountSelectForTest).sort()).toEqual(
		relations,
	)
	for (const name of [
		'consumptionEvents',
		'consents',
		'twoFactorRecoveryCodes',
		'safetyControlsOwned',
		'safetyControlsReceived',
	]) {
		expect(Object.keys(fixtureAccountCountSelectForTest)).toContain(name)
	}
})

test('every Watchlist and TrackingState relation is classified before a seed account is removed', async () => {
	// The seed accounts come with structure — four watchlists holding twenty-six
	// entries — so counting that would make none of them removable. What must
	// block removal is evidence a real person used the account, and progress and
	// consumption events were not counted, so someone who had watched episodes on
	// a seed account still looked untouched.
	const { Prisma } = await import('@prisma/client')
	for (const model of ['Watchlist', 'TrackingState'] as const) {
		const relations = Prisma.dmmf.datamodel.models
			.find(entry => entry.name === model)!
			.fields.filter(field => field.kind === 'object' && field.isList)
			.map(field => field.name)
			.sort()
		expect(
			Object.keys(seedRowActivityOwnership[model]).sort(),
			`${model} has a relation nothing has classified`,
		).toEqual(relations)
	}
})

test('watching something on a seed account keeps it from being removed', () => {
	expect(Object.keys(trackingStateActivitySelect)).toEqual(
		expect.arrayContaining(['progress', 'consumptionEvents', 'activityEvents']),
	)
	// Entries are seed structure; counting those would mean no seed account could
	// ever be removed.
	expect(Object.keys(trackingStateActivitySelect)).not.toContain('entries')
	expect(Object.keys(watchlistActivitySelect)).not.toContain('entries')
})

test('what deletion keeps is exactly what the copy says it keeps', () => {
	// The delete-account copy tells members their account is removed and that
	// moderation and safety records are kept without their account named in
	// them. That is a promise in both directions, so the set is pinned rather
	// than pattern-matched: a new survivor would mean something is kept that the
	// copy does not mention, and a survivor that starts cascading would mean the
	// copy promises to keep a record that in fact goes.
	//
	// `SetNull` is what makes the second half true — the row outlives the
	// account with the reference emptied. Anything else here would either block
	// deletion outright or take the record with it.
	const survives: string[] = []
	for (const model of Prisma.dmmf.datamodel.models) {
		for (const field of model.fields) {
			if (field.kind !== 'object' || field.type !== 'User') continue
			if (!field.relationFromFields?.length) continue
			if (field.relationOnDelete === 'Cascade') continue
			survives.push(`${model.name}.${field.name}:${field.relationOnDelete}`)
		}
	}

	expect(survives.sort()).toEqual([
		'CatalogMediaMerge.appliedBy:SetNull',
		'CatalogMediaMerge.preparedBy:SetNull',
		'CatalogMediaMerge.revertedBy:SetNull',
		'CatalogMediaMergeEvent.actor:SetNull',
		'CatalogQualityEvent.actor:SetNull',
		'CatalogQualityIssue.reviewedBy:SetNull',
		'ModerationAction.actor:SetNull',
		'ModerationAction.subject:SetNull',
		'ModerationReport.assignedTo:SetNull',
		'ModerationReport.subject:SetNull',
		'ServiceIncidentEvent.actor:SetNull',
	])
})
