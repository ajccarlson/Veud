import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { BASE_URL } from '#tests/utils.ts'
import { loader as mediaLoader } from './sitemap.media.$page[.]xml.ts'
import { loader as indexLoader } from './sitemap[.]xml.ts'

function request(path: string) {
	return new Request(`${BASE_URL}${path}`)
}

async function seedMedia(count: number) {
	const suffix = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const ids: string[] = []
	for (let index = 0; index < count; index++) {
		const media = await prisma.media.create({
			data: { kind: 'movie', title: `Sitemap title ${suffix} ${index}` },
		})
		ids.push(media.id)
	}
	return ids
}

test('the index advertises the site pages and every catalog chunk', async () => {
	await seedMedia(2)

	const response = await indexLoader({
		request: request('/sitemap.xml'),
	} as unknown as Parameters<typeof indexLoader>[0])
	const body = await response.text()

	expect(response.headers.get('Content-Type')).toBe(
		'application/xml; charset=utf-8',
	)
	expect(body).toContain('<sitemapindex')
	expect(body).toContain(`${BASE_URL}/sitemap/pages.xml`)
	expect(body).toContain(`${BASE_URL}/sitemap/media/1.xml`)
	// An index must not inline the pages themselves.
	expect(body).not.toContain('<url>')
})

test('a catalog chunk lists the media pages a crawler should visit', async () => {
	const ids = await seedMedia(3)

	const response = await mediaLoader({
		request: request('/sitemap/media/1.xml'),
		params: { page: '1' },
	} as unknown as Parameters<typeof mediaLoader>[0])
	const body = await response.text()

	expect(body).toContain('<urlset')
	for (const id of ids) {
		expect(body).toContain(`<loc>${BASE_URL}/media/${id}</loc>`)
	}
	expect(body).toContain('<changefreq>weekly</changefreq>')
})

test('media without a title is never offered to a crawler', async () => {
	// Hydration creates a record before a provider has named it. A page with no
	// title is not one to invite a crawler to.
	const untitled = await prisma.media.create({ data: { kind: 'movie' } })
	const [titled] = await seedMedia(1)

	const response = await mediaLoader({
		request: request('/sitemap/media/1.xml'),
		params: { page: '1' },
	} as unknown as Parameters<typeof mediaLoader>[0])
	const body = await response.text()

	expect(body).not.toContain(untitled.id)
	// And the titled one beside it is still listed, so this is not passing
	// because the chunk came back empty.
	expect(body).toContain(`<loc>${BASE_URL}/media/${titled}</loc>`)
})

test('a page beyond the catalog is a 404, not an empty sitemap', async () => {
	await seedMedia(1)
	// An empty <urlset> tells a crawler the chunk exists and is empty, which is
	// a different and worse claim than the chunk not existing.
	await expect(
		mediaLoader({
			request: request('/sitemap/media/9.xml'),
			params: { page: '9' },
		} as unknown as Parameters<typeof mediaLoader>[0]),
	).rejects.toMatchObject({ status: 404 })
})

test('a page number that was never advertised is refused', async () => {
	for (const page of ['0', '-1', 'abc', '9999999999']) {
		await expect(
			mediaLoader({
				request: request(`/sitemap/media/${page}.xml`),
				params: { page },
			} as unknown as Parameters<typeof mediaLoader>[0]),
		).rejects.toMatchObject({ status: 404 })
	}
})
