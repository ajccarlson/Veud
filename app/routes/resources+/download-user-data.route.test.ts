import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import {
	getPasswordHash,
	getSessionExpirationDate,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './download-user-data.tsx'

test('account export includes private recommendation feedback but omits passwords', async () => {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `export_${suffix}@example.com`,
			username: `export_${suffix}`,
			password: {
				create: { hash: await getPasswordHash('Export-password-1') },
			},
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: `Export title ${suffix}` },
	})
	const feedback = await prisma.recommendationFeedback.create({
		data: {
			ownerId: user.id,
			mediaId: media.id,
			feedbackType: 'show_less',
			sourceLane: 'taste',
		},
	})
	const moderationReport = await prisma.moderationReport.create({
		data: {
			reporterId: user.id,
			targetType: 'account',
			targetId: 'reported-account-id',
			reasonCategory: 'harassment',
			details: 'Exported report context.',
		},
	})
	const moderationAction = await prisma.moderationAction.create({
		data: {
			subjectId: user.id,
			action: 'account_warn',
			targetType: 'account',
			targetId: user.id,
			reason: 'Exported enforcement reason.',
		},
	})
	const importBatch = await prisma.libraryImportBatch.create({
		data: {
			ownerId: user.id,
			provider: 'letterboxd',
			fileName: 'watched.csv',
			itemCount: 1,
			matchedCount: 0,
			ambiguousCount: 0,
			unmatchedCount: 1,
			conflictCount: 0,
			items: {
				create: {
					sourceKey: 'letterboxd:movie:arrival',
					payload: '{"title":"Arrival"}',
					matchState: 'unmatched',
				},
			},
		},
		include: { items: true },
	})
	await prisma.homeDashboardPreference.create({
		data: {
			ownerId: user.id,
			density: 'compact',
			moduleOrder: JSON.stringify([
				'library',
				'trending',
				'continue',
				'recommendations',
				'following',
				'upcoming',
			]),
			collapsedModules: JSON.stringify(['following']),
		},
	})
	await prisma.notificationPreference.create({
		data: {
			ownerId: user.id,
			inAppSocial: false,
			emailSocial: true,
			digestFrequency: 'weekly',
		},
	})
	const session = await prisma.session.create({
		data: {
			userId: user.id,
			expirationDate: getSessionExpirationDate(),
		},
	})
	const cookie = await getSessionCookieHeader(session)
	const request = new Request(`${BASE_URL}/resources/download-user-data`, {
		headers: { cookie },
	})

	const response = await loader({
		request,
		url: new URL(request.url),
	} as any)
	const exported = (await response.json()) as {
		user: {
			password?: unknown
			recommendationFeedback: Array<{
				id: string
				mediaId: string
				feedbackType: string
				sourceLane: string | null
			}>
			homeDashboardPreference: {
				density: string
				moduleOrder: string
				collapsedModules: string
			}
			notificationPreference: {
				inAppSocial: boolean
				emailSocial: boolean
				digestFrequency: string
			}
			libraryImportBatches: Array<{
				id: string
				provider: string
				items: Array<{ sourceKey: string }>
			}>
			moderationReportsSubmitted: Array<{ id: string; details: string }>
			moderationActionsSubject: Array<{ id: string; reason: string }>
		}
	}

	expect(exported.user.password).toBeUndefined()
	expect(exported.user.recommendationFeedback).toEqual([
		expect.objectContaining({
			id: feedback.id,
			mediaId: media.id,
			feedbackType: 'show_less',
			sourceLane: 'taste',
		}),
	])
	expect(exported.user.homeDashboardPreference).toEqual(
		expect.objectContaining({
			density: 'compact',
			collapsedModules: JSON.stringify(['following']),
		}),
	)
	expect(exported.user.notificationPreference).toEqual(
		expect.objectContaining({
			inAppSocial: false,
			emailSocial: true,
			digestFrequency: 'weekly',
		}),
	)
	expect(exported.user.libraryImportBatches).toEqual([
		expect.objectContaining({
			id: importBatch.id,
			provider: 'letterboxd',
			items: [
				expect.objectContaining({
					sourceKey: 'letterboxd:movie:arrival',
				}),
			],
		}),
	])
	expect(exported.user.moderationReportsSubmitted).toEqual([
		expect.objectContaining({
			id: moderationReport.id,
			details: 'Exported report context.',
		}),
	])
	expect(exported.user.moderationActionsSubject).toEqual([
		expect.objectContaining({
			id: moderationAction.id,
			reason: 'Exported enforcement reason.',
		}),
	])
	expect(response.headers.get('cache-control')).toBe('private, no-store')
})
