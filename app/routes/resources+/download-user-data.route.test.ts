import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import {
	getPasswordHash,
	getSessionExpirationDate,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	loader,
	userExportDispositions,
	userExportInclude,
} from './download-user-data.tsx'

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
			sessions: Array<{
				id?: string
				userId?: string
				expirationDate: string
			}>
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
	expect(exported.user.sessions).toHaveLength(1)
	expect(exported.user.sessions[0]).not.toHaveProperty('id')
	expect(exported.user.sessions[0]).not.toHaveProperty('userId')
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

test('the export contains the library and the writing, not just the account', async () => {
	// It claimed to export everything while omitting watchlists, entries,
	// reviews, diary entries, comments, collections and favorites — which is a
	// trust problem before it is a feature gap.
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `full_${suffix}@example.com`,
			username: `full_${suffix}`,
		},
	})
	const listType = await prisma.listType.upsert({
		where: { name: 'anime' },
		update: {},
		create: {
			name: 'anime',
			header: 'Anime',
			columns: '{}',
			mediaType: '["episode"]',
			completionType: '{}',
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'anime', title: `Full export ${suffix}` },
	})
	const watchlist = await prisma.watchlist.create({
		data: {
			ownerId: user.id,
			typeId: listType.id,
			name: 'watching',
			header: 'Watching',
			position: 1,
			entries: {
				create: { position: 1, title: `Entry ${suffix}`, mediaId: media.id },
			},
		},
	})
	const review = await prisma.review.create({
		data: {
			mediaId: media.id,
			authorId: user.id,
			body: `Review body ${suffix}`,
			moderationStatus: 'visible',
		},
	})
	const diaryEntry = await prisma.diaryEntry.create({
		data: {
			ownerId: user.id,
			mediaId: media.id,
			loggedOn: new Date('2026-08-01T00:00:00.000Z'),
		},
	})
	await prisma.userFavorite.create({
		data: {
			ownerId: user.id,
			mediaId: media.id,
			typeId: listType.id,
			position: 1,
			title: `Favorite ${suffix}`,
		},
	})

	const request = new Request(`${BASE_URL}/resources/download-user-data`, {
		headers: {
			cookie: await getSessionCookieHeader(
				await prisma.session.create({
					data: {
						userId: user.id,
						expirationDate: new Date(Date.now() + 86_400_000),
					},
				}),
			),
		},
	})
	const response = await loader({ request, url: new URL(request.url) } as any)
	const exported = (await response.json()) as { user: Record<string, any> }

	expect(exported.user.watchlists?.[0]?.id).toBe(watchlist.id)
	// The entries inside them, not merely the list names.
	expect(exported.user.watchlists?.[0]?.entries?.[0]?.title).toBe(
		`Entry ${suffix}`,
	)
	expect(exported.user.reviews?.[0]?.id).toBe(review.id)
	expect(exported.user.reviews?.[0]?.body).toBe(`Review body ${suffix}`)
	expect(exported.user.diaryEntries?.[0]?.id).toBe(diaryEntry.id)
	expect(exported.user.userFavorites).toHaveLength(1)
	// Still no credentials.
	expect(exported.user.password).toBeUndefined()
})

test('the export carries what this member wrote, never what others wrote about them', async () => {
	// profileComments is the inbound relation — comments others left ON this
	// profile. Exporting it hands one member other people's words.
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const [subject, other] = await Promise.all([
		prisma.user.create({
			data: { email: `subj_${suffix}@example.com`, username: `subj_${suffix}` },
		}),
		prisma.user.create({
			data: { email: `othr_${suffix}@example.com`, username: `othr_${suffix}` },
		}),
	])
	await prisma.profileComment.create({
		data: {
			authorId: other.id,
			profileId: subject.id,
			body: `SOMEONE ELSES WORDS ${suffix}`,
		},
	})
	await prisma.profileComment.create({
		data: {
			authorId: subject.id,
			profileId: other.id,
			body: `MY OWN WORDS ${suffix}`,
		},
	})

	const request = new Request(`${BASE_URL}/resources/download-user-data`, {
		headers: {
			cookie: await getSessionCookieHeader(
				await prisma.session.create({
					data: {
						userId: subject.id,
						expirationDate: new Date(Date.now() + 86_400_000),
					},
				}),
			),
		},
	})
	const response = await loader({ request, url: new URL(request.url) } as any)
	const body = await response.text()

	expect(body).toContain(`MY OWN WORDS ${suffix}`)
	expect(body).not.toContain(`SOMEONE ELSES WORDS ${suffix}`)
})

test('every User relation is classified as exported or withheld', async () => {
	// The export omitted the member's lists, entries, reviews and diary until it
	// was noticed by hand. Nothing stopped the next relation going the same way:
	// the include is written out by hand and never compared to the schema.
	//
	// This is that comparison. Adding a relation to User without deciding
	// whether a member's own data export contains it fails here.
	const { Prisma } = await import('@prisma/client')
	const user = Prisma.dmmf.datamodel.models.find(model => model.name === 'User')
	expect(user, 'User model missing from the Prisma DMMF').toBeDefined()

	const relations = user!.fields
		.filter(field => field.kind === 'object')
		.map(field => field.name)
		.sort()

	expect(relations).toEqual(Object.keys(userExportDispositions).sort())
})

test('the include carries exactly the relations the ledger says it does', async () => {
	// A relation can be listed as exported and still be missing from the query,
	// which would read as a decision that was never carried out.
	const exported = Object.entries(userExportDispositions)
		.filter(([, disposition]) => disposition === 'exported')
		.map(([name]) => name)
		.sort()
	const included = Object.entries(userExportInclude)
		.filter(([, value]) => value !== false)
		.map(([name]) => name)
		.sort()

	expect(included).toEqual(exported)

	// And nothing withheld is quietly present.
	const withheld = Object.entries(userExportDispositions)
		.filter(([, disposition]) => disposition !== 'exported')
		.map(([name]) => name)
	for (const name of withheld) {
		expect(
			included,
			`${name} is withheld but appears in the export include`,
		).not.toContain(name)
	}
})

test('credentials are never exported, whatever the ledger says', async () => {
	// A backstop that does not depend on the ledger being right: if someone
	// reclassifies a credential as exported, the ledger test would happily pass.
	for (const name of ['password', 'twoFactorRecoveryCodes'] as const) {
		expect(userExportDispositions[name]).toBe('withheld:credential')
		expect(Object.keys(userExportInclude)).not.toContain(
			name === 'password' ? 'NEVER' : name,
		)
	}
	// `password: false` is deliberately present as an explicit denial.
	expect(userExportInclude.password).toBe(false)
})
