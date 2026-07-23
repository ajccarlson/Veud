import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './profile.import.tsx'

async function importRequest(source: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	const user = await prisma.user.create({
		data: {
			username: `import_${suffix}`,
			email: `import_${suffix}@example.com`,
		},
	})
	const session = await prisma.session.create({
		data: { userId: user.id, expirationDate: getSessionExpirationDate() },
	})
	const formData = new FormData()
	formData.set('provider', 'myanimelist')
	formData.set(
		'library',
		new File([source], 'mal.xml', { type: 'application/xml' }),
	)
	const url = new URL(`${BASE_URL}/settings/profile/import`)
	return {
		args: {
			request: new Request(url, {
				method: 'POST',
				headers: { cookie: await getSessionCookieHeader(session) },
				body: formData,
			}),
			url,
			params: {},
		} as any,
	}
}

test('builds a non-mutating import reconciliation preview', async () => {
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			title: 'Import route fixture',
			externalIds: {
				create: { provider: 'mal', kind: 'anime', externalId: '9911' },
			},
		},
	})
	const { args } = await importRequest(`
		<myanimelist><anime>
			<series_animedb_id>9911</series_animedb_id>
			<series_title>Imported title</series_title>
			<my_status>Completed</my_status><my_score>8</my_score>
		</anime></myanimelist>
	`)
	const before = await prisma.trackingState.count()
	const response = await action(args)
	if (response instanceof Response) {
		throw new Error('Expected a preview response')
	}
	if (!response.data.ok || !response.data.batchId) {
		throw new Error('Expected a successful persisted preview')
	}
	expect(response.data).toEqual(
		expect.objectContaining({
			ok: true,
			batchId: expect.any(String),
		}),
	)
	expect(await prisma.trackingState.count()).toBe(before)
	const batch = await prisma.libraryImportBatch.findUniqueOrThrow({
		where: { id: response.data.batchId },
		include: { items: true },
	})
	expect(batch).toEqual(
		expect.objectContaining({
			matchedCount: 1,
			status: 'previewed',
			items: [
				expect.objectContaining({
					mediaId: media.id,
					resolution: 'add',
				}),
			],
		}),
	)
})
