import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
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

function loaderArgs(cookie: string) {
	const url = new URL(`${BASE_URL}/moderation`)
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
	if (!submitted.data.ok) throw new Error('Expected report submission to succeed')
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
