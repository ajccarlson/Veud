import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import { BASE_URL } from '#tests/utils.ts'
import { action as appealAction } from './appeal.tsx'
import { action as verifyAction } from './verify.tsx'

function appealRequest(
	usernameOrEmail: string,
	details = 'The suspension decision is missing important context.',
) {
	return new Request(`${BASE_URL}/appeal`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ usernameOrEmail, details }),
	})
}

test('suspension appeals require email verification without disclosing account existence', async () => {
	const suffix = faker.string.alphanumeric({ length: 12 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			email: `appeal_${suffix}@example.com`,
			username: `appeal_${suffix}`,
			accountStatus: 'suspended',
		},
	})
	const decision = await prisma.moderationAction.create({
		data: {
			subjectId: user.id,
			action: 'account_suspend',
			targetType: 'account',
			targetId: user.id,
			reason: 'Suspension appeal route fixture.',
			previousStatus: 'active',
			nextStatus: 'suspended',
		},
	})

	const [existing, absent] = await Promise.all([
		appealAction({ request: appealRequest(user.email) } as any),
		appealAction({
			request: appealRequest(`absent_${suffix}@example.com`),
		} as any),
	])
	for (const response of [existing, absent]) {
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).status).toBe(302)
		expect((response as Response).headers.get('location')).toContain('/verify?')
	}

	expect(
		await prisma.moderationReport.count({
			where: { appealOfActionId: decision.id },
		}),
	).toBe(0)
	const draft = await prisma.moderationAppealDraft.findFirstOrThrow({
		where: { actionId: decision.id },
	})
	expect(draft).toMatchObject({
		userId: user.id,
		details: 'The suspension decision is missing important context.',
	})
	const email = await readEmail(user.email)
	expect(email).not.toBeNull()
	const code = email!.text.match(/verification code ([A-Z0-9]{6})/i)?.[1]
	expect(code).toBeTruthy()

	const verifyUrl = new URL(`${BASE_URL}/verify`)
	const verified = await verifyAction({
		request: new Request(verifyUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code: code!,
				type: 'moderation-appeal',
				target: draft.id,
			}),
		}),
		url: verifyUrl,
		params: {},
	} as any)
	expect(verified).toBeInstanceOf(Response)
	expect((verified as Response).status).toBe(302)
	expect((verified as Response).headers.get('location')).toBe('/login')
	expect(
		await prisma.moderationReport.findFirstOrThrow({
			where: { appealOfActionId: decision.id },
			select: { status: true, reporterId: true },
		}),
	).toEqual({ status: 'open', reporterId: user.id })
	expect(
		await prisma.moderationAppealDraft.findUnique({
			where: { id: draft.id },
		}),
	).toBeNull()
})

test('appeal details are bounded before any moderation record is created', async () => {
	const response = await appealAction({
		request: appealRequest('missing@example.com', 'short'),
	} as any)
	expect(
		response instanceof Response ? response.status : response.init?.status,
	).toBe(400)
	expect(await prisma.moderationReport.count()).toBe(0)
})
