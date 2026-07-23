import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { loader as bannerLoader } from './user-banners.$imageId.tsx'
import { loader as imageLoader } from './user-images.$imageId.tsx'

async function createUser(prefix: string) {
	const suffix = faker.string.alphanumeric({ length: 10 }).toLowerCase()
	return prisma.user.create({
		data: {
			email: `${prefix}_${suffix}@example.com`,
			username: `${prefix}_${suffix}`,
		},
	})
}

test('safe profile images are served with immutable nosniff headers', async () => {
	const [photoOwner, bannerOwner] = await Promise.all([
		createUser('safe_photo'),
		createUser('safe_banner'),
	])
	const [image, banner] = await Promise.all([
		prisma.userImage.create({
			data: {
				userId: photoOwner.id,
				contentType: 'image/jpeg',
				blob: Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
			},
		}),
		prisma.userBanner.create({
			data: {
				userId: bannerOwner.id,
				contentType: 'image/png',
				blob: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			},
		}),
	])

	for (const [loader, id, contentType] of [
		[imageLoader, image.id, 'image/jpeg'],
		[bannerLoader, banner.id, 'image/png'],
	] as const) {
		const response = await loader({ params: { imageId: id } } as any)
		expect(response.headers.get('content-type')).toBe(contentType)
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(response.headers.get('cache-control')).toContain('immutable')
	}
})

test('legacy active-content uploads are no longer served inline', async () => {
	const owner = await createUser('unsafe_photo')
	const image = await prisma.userImage.create({
		data: {
			userId: owner.id,
			contentType: 'text/html',
			blob: Buffer.from('<script>alert(document.cookie)</script>'),
		},
	})

	const result = await imageLoader({
		params: { imageId: image.id },
	} as any).catch(error => error)
	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(404)
})
