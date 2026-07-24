import { describe, expect, test } from 'vitest'
import { prisma } from './db.server.ts'
import {
	attachmentTotal,
	confirmedFixtureAccount,
	confirmedFixtureFamily,
	confirmedLeakedMediaFixtures,
	E2E_MEDIA_TITLE_PREFIX,
	knownMediaFixtureTitles,
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
