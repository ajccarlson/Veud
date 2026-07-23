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
	expect(response.headers.get('cache-control')).toBe('private, no-store')
})
