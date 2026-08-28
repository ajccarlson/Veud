import { faker } from '@faker-js/faker'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	action as moderationAction,
	loader as moderationLoader,
} from './moderation.tsx'
import { action as reportAction } from './resources+/report-content.ts'

type PermissionSeed = {
	action: string
	entity: string
	access: string
}

afterEach(() => vi.restoreAllMocks())

async function createUser(
	prefix: string,
	roleName?: string,
	permissions: PermissionSeed[] = [],
) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	if (roleName) {
		const permissionLinks = permissions.map(permission => ({
			where: {
				action_entity_access: permission,
			},
			create: permission,
		}))
		await prisma.role.upsert({
			where: { name: roleName },
			create: {
				name: roleName,
				permissions: {
					connectOrCreate: permissionLinks,
				},
			},
			update: {
				permissions: { connectOrCreate: permissionLinks },
			},
		})
	}
	const user = await prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
			roles: roleName ? { connect: { name: roleName } } : undefined,
		},
	})
	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	return { user, cookie: await getSessionCookieHeader(session) }
}

function loaderArgs(
	cookie: string,
	query: Record<string, string | string[]> = {},
) {
	const url = new URL(`${BASE_URL}/moderation`)
	for (const [name, values] of Object.entries(query)) {
		for (const value of Array.isArray(values) ? values : [values]) {
			url.searchParams.append(name, value)
		}
	}
	return {
		request: new Request(url, { headers: { cookie } }),
		url,
		params: {},
	} as any
}

function postArgs(
	path: string,
	cookie: string,
	values: Record<string, string>,
) {
	const url = new URL(`${BASE_URL}${path}`)
	return {
		request: new Request(url, {
			method: 'POST',
			headers: {
				cookie,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(values),
		}),
		url,
		params: {},
	} as any
}

test('the dashboard is private to moderators and returns a no-store queue', async () => {
	const member = await createUser('member')
	await expect(
		moderationLoader(loaderArgs(member.cookie)),
	).rejects.toMatchObject({ status: 403 })

	const moderator = await createUser('moderator', 'moderator', [
		{ action: 'read', entity: 'report', access: 'any' },
	])
	const response = await moderationLoader(loaderArgs(moderator.cookie))
	expect(response.init?.headers).toEqual(
		expect.objectContaining({ 'Cache-Control': 'private, no-store' }),
	)
	expect(response.data.reports).toEqual([])
	expect(response.data.canAssignRoles).toBe(false)
})

test('moderators can find display names without matching their casing', async () => {
	const moderator = await createUser('case_moderator', 'moderator', [
		{ action: 'read', entity: 'report', access: 'any' },
	])
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const member = await prisma.user.create({
		data: {
			email: `case_target_${suffix}@example.com`,
			username: `unrelated_${suffix}`,
			name: `MiXeD Display ${suffix}`,
		},
	})
	await prisma.user.create({
		data: {
			email: `case_other_${suffix}@example.com`,
			username: `other_${suffix}`,
			name: `Different member ${suffix}`,
		},
	})

	const response = await moderationLoader(
		loaderArgs(moderator.cookie, {
			q: `mIxEd dIsPlAy ${suffix.toUpperCase()}`,
			view: 'members',
		}),
	)
	expect(response.data.members.map(result => result.id)).toEqual([member.id])
})

test('each moderation view executes only its own query plan', async () => {
	const moderator = await createUser('gated_moderator', 'moderator', [
		{ action: 'read', entity: 'report', access: 'any' },
	])
	const reportPage = vi.spyOn(prisma.moderationReport, 'findMany')
	const actionPage = vi.spyOn(prisma.moderationAction, 'findMany')
	const userPage = vi.spyOn(prisma.user, 'findMany')
	const reviewPage = vi.spyOn(prisma.review, 'findMany')

	try {
		const response = await moderationLoader(
			loaderArgs(moderator.cookie, { view: 'audit' }),
		)
		expect(response.data.reports).toEqual([])
		expect(reportPage).not.toHaveBeenCalled()
		expect(actionPage).toHaveBeenCalledTimes(1)
		expect(userPage).not.toHaveBeenCalled()
		expect(reviewPage).not.toHaveBeenCalled()

		reportPage.mockClear()
		actionPage.mockClear()
		userPage.mockClear()
		reviewPage.mockClear()
		await moderationLoader(
			loaderArgs(moderator.cookie, {
				view: 'team',
				q: moderator.user.username,
			}),
		)
		expect(reportPage).not.toHaveBeenCalled()
		expect(actionPage).not.toHaveBeenCalled()
		expect(userPage).toHaveBeenCalledTimes(2)
		expect(reviewPage).not.toHaveBeenCalled()

		reportPage.mockClear()
		actionPage.mockClear()
		userPage.mockClear()
		reviewPage.mockClear()
		await moderationLoader(
			loaderArgs(moderator.cookie, {
				view: 'members',
				q: moderator.user.username,
			}),
		)
		expect(reportPage).not.toHaveBeenCalled()
		expect(actionPage).not.toHaveBeenCalled()
		expect(userPage).toHaveBeenCalledTimes(1)
		expect(reviewPage).not.toHaveBeenCalled()

		reportPage.mockClear()
		actionPage.mockClear()
		userPage.mockClear()
		reviewPage.mockClear()
		await moderationLoader(loaderArgs(moderator.cookie, { view: 'queue' }))
		expect(reportPage).toHaveBeenCalledTimes(2)
		expect(actionPage).not.toHaveBeenCalled()
		expect(userPage).not.toHaveBeenCalled()
		expect(reviewPage).not.toHaveBeenCalled()
	} finally {
		vi.restoreAllMocks()
	}
})

test('the report queue reaches tied rows without crossing its status filter', async () => {
	const moderator = await createUser('queue_moderator', 'moderator', [
		{ action: 'read', entity: 'report', access: 'any' },
	])
	const reporter = await createUser('queue_reporter')
	const target = await createUser('queue_target')
	const suffix = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const createdAt = new Date('2026-08-28T20:00:00.000Z')
	const ids = Array.from(
		{ length: 65 },
		(_, index) => `queue_${suffix}_${String(index).padStart(3, '0')}`,
	)
	await prisma.moderationReport.createMany({
		data: ids.map((id, index) => ({
			id,
			reporterId: reporter.user.id,
			subjectId: target.user.id,
			targetType: 'account',
			targetId: target.user.id,
			reasonCategory: 'other',
			status: index % 2 ? 'in_review' : 'open',
			priority: 'normal',
			createdAt,
		})),
	})
	const reportPages = vi.spyOn(prisma.moderationReport, 'findMany')
	const accountBatch = vi.spyOn(prisma.user, 'findMany')
	const first = await moderationLoader(
		loaderArgs(moderator.cookie, { view: 'queue', status: 'active' }),
	)
	expect(first.data.reports.map(report => report.id)).toEqual(ids.slice(0, 60))
	expect(first.data.nextCursor).toBe(ids[59])
	expect(first.data.hasCursor).toBe(false)
	expect(reportPages).toHaveBeenCalledTimes(2)
	expect(reportPages).toHaveBeenNthCalledWith(
		1,
		expect.objectContaining({
			take: 61,
			where: { AND: [expect.anything(), { status: 'open' }] },
		}),
	)
	expect(reportPages).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({
			take: 61,
			where: { AND: [expect.anything(), { status: 'in_review' }] },
		}),
	)
	expect(accountBatch).toHaveBeenCalledTimes(1)

	const second = await moderationLoader(
		loaderArgs(moderator.cookie, {
			view: 'queue',
			status: 'active',
			cursor: ids[59],
		}),
	)
	expect(second.data.reports.map(report => report.id)).toEqual(ids.slice(60))
	expect(second.data.nextCursor).toBeNull()
	expect(second.data.hasCursor).toBe(true)
	expect(reportPages).toHaveBeenCalledTimes(4)
	reportPages.mockRestore()
	accountBatch.mockRestore()

	const resolved = await prisma.moderationReport.create({
		data: {
			reporterId: reporter.user.id,
			targetType: 'account',
			targetId: target.user.id,
			reasonCategory: 'other',
			status: 'resolved',
		},
		select: { id: true },
	})
	await expect(
		moderationLoader(
			loaderArgs(moderator.cookie, {
				view: 'queue',
				status: 'active',
				cursor: resolved.id,
			}),
		),
	).rejects.toMatchObject({ status: 400 })
})

test('the audit log reaches tied rows and rejects hostile cursors', async () => {
	const moderator = await createUser('audit_moderator', 'moderator', [
		{ action: 'read', entity: 'report', access: 'any' },
	])
	const suffix = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const createdAt = new Date('2026-08-28T21:00:00.000Z')
	const ids = Array.from(
		{ length: 105 },
		(_, index) => `audit_${suffix}_${String(index).padStart(3, '0')}`,
	)
	await prisma.moderationAction.createMany({
		data: ids.map(id => ({
			id,
			action: 'account_warn',
			targetType: 'account',
			targetId: moderator.user.id,
			reason: `Audit fixture ${id}`,
			createdAt,
		})),
	})

	const expected = [...ids].reverse()
	const first = await moderationLoader(
		loaderArgs(moderator.cookie, { view: 'audit' }),
	)
	expect(first.data.recentActions.map(action => action.id)).toEqual(
		expected.slice(0, 100),
	)
	expect(first.data.nextCursor).toBe(expected[99])

	const second = await moderationLoader(
		loaderArgs(moderator.cookie, {
			view: 'audit',
			cursor: expected[99],
		}),
	)
	expect(second.data.recentActions.map(action => action.id)).toEqual(
		expected.slice(100),
	)
	expect(second.data.nextCursor).toBeNull()

	for (const cursor of ['missing-action', ' whitespace', 'x'.repeat(101)]) {
		await expect(
			moderationLoader(loaderArgs(moderator.cookie, { view: 'audit', cursor })),
		).rejects.toMatchObject({ status: 400 })
	}
	await expect(
		moderationLoader(
			loaderArgs(moderator.cookie, {
				view: 'audit',
				cursor: [expected[99], expected[100]],
			}),
		),
	).rejects.toMatchObject({ status: 400 })
})

test('members can submit one private report while moderators can resolve its workflow', async () => {
	const reporter = await createUser('reporter', 'user', [
		{ action: 'create', entity: 'report', access: 'own' },
	])
	const author = await createUser('author')
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Route report fixture' },
	})
	const review = await prisma.review.create({
		data: {
			authorId: author.user.id,
			mediaId: media.id,
			body: 'A route-level moderation fixture.',
		},
	})

	const submitted = await reportAction(
		postArgs('/resources/report-content', reporter.cookie, {
			targetType: 'review',
			targetId: review.id,
			reasonCategory: 'spam',
			details: 'Repeated promotional links.',
		}),
	)
	expect(submitted.data).toEqual(
		expect.objectContaining({ ok: true, duplicate: false }),
	)
	if (!submitted.data.ok)
		throw new Error('Expected report submission to succeed')
	const reportId = submitted.data.reportId

	const duplicate = await reportAction(
		postArgs('/resources/report-content', reporter.cookie, {
			targetType: 'review',
			targetId: review.id,
			reasonCategory: 'spam',
			details: '',
		}),
	)
	expect(duplicate.data).toEqual(
		expect.objectContaining({
			ok: true,
			duplicate: true,
			reportId,
		}),
	)

	const moderator = await createUser('moderator', 'moderator', [
		{ action: 'update', entity: 'report', access: 'any' },
	])
	const resolved = await moderationAction(
		postArgs('/moderation', moderator.cookie, {
			intent: 'resolve',
			reportId,
			reason: 'Reviewed and resolved with the author.',
		}),
	)
	expect(resolved.data).toEqual(
		expect.objectContaining({ ok: true, message: 'Report marked resolved.' }),
	)
	expect(
		await prisma.moderationReport.findUniqueOrThrow({
			where: { id: reportId },
			select: { status: true, assignedToId: true },
		}),
	).toEqual({ status: 'resolved', assignedToId: moderator.user.id })
})
