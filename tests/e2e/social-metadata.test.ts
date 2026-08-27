import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function readStructuredData(page: Page) {
	const raw = await page
		.locator('script[type="application/ld+json"]')
		.first()
		.textContent()
	return JSON.parse(raw ?? '{}') as Record<string, any>
}

test('a shared title page carries a card and structured data', async ({
	page,
	insertNewUser,
}) => {
	// Signed out on purpose: this is what a crawler and a chat server see, and
	// neither of them has a session.
	const member = await insertNewUser()
	const media = await prisma.media.create({
		data: {
			kind: 'anime',
			type: 'TV',
			title: 'Social Card Browser Fixture',
			description:
				'An elf outlives her party.<br><br>Then she walks &mdash; slowly &mdash; north.',
			genres: 'Adventure, Fantasy',
			releaseStart: new Date('2023-09-29T00:00:00Z'),
			thumbnail:
				'https://cdn.example/social-card-cover.jpg|https://mal.example/1',
		},
	})
	await prisma.trackingState.create({
		data: {
			ownerId: member.id,
			mediaId: media.id,
			status: 'completed',
			score: 9,
		},
	})

	try {
		// A tracking parameter, so the canonical link has something to correct.
		await page.goto(`/media/${media.id}?utm_source=chat`)

		const content = (selector: string) =>
			page.locator(selector).first().getAttribute('content')

		await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
		expect(await content('meta[property="og:title"]')).toBe(
			'Social Card Browser Fixture | Veud',
		)
		expect(await content('meta[property="og:type"]')).toBe('video.tv_show')
		expect(await content('meta[property="og:site_name"]')).toBe('Veud')

		// Markup from the provider does not reach the card as angle brackets.
		const description = await content('meta[property="og:description"]')
		expect(description).toBe(
			'An elf outlives her party. Then she walks — slowly — north.',
		)
		expect(await content('meta[name="twitter:description"]')).toBe(description)

		// Absolute, because a chat server fetches these with no page context.
		expect(await content('meta[property="og:image"]')).toBe(
			'https://cdn.example/social-card-cover.jpg',
		)
		expect(await content('meta[name="twitter:card"]')).toBe(
			'summary_large_image',
		)

		const canonical = await page
			.locator('link[rel="canonical"]')
			.getAttribute('href')
		expect(canonical).toMatch(new RegExp(`^https?://.+/media/${media.id}$`))
		// The tracking parameter is exactly what canonical exists to strip.
		expect(canonical).not.toContain('utm_source')
		expect(await content('meta[property="og:url"]')).toBe(canonical)

		const structured = await readStructuredData(page)
		expect(structured['@context']).toBe('https://schema.org')
		expect(structured['@type']).toBe('TVSeries')
		expect(structured.name).toBe('Social Card Browser Fixture')
		expect(structured.genre).toEqual(['Adventure', 'Fantasy'])
		expect(structured.datePublished).toBe('2023-09-29')
		expect(structured.aggregateRating).toMatchObject({
			'@type': 'AggregateRating',
			ratingValue: 9,
			ratingCount: 1,
		})
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('a title nobody has rated claims no rating', async ({ page }) => {
	// An aggregateRating with nothing behind it is the kind of claim search
	// engines penalise, and rightly.
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Unrated Browser Fixture' },
	})

	try {
		await page.goto(`/media/${media.id}`)
		const structured = await readStructuredData(page)
		expect(structured['@type']).toBe('Movie')
		expect(structured.aggregateRating).toBeUndefined()
		// Nothing is published as an empty string either.
		for (const value of Object.values(structured)) {
			expect(value).not.toBe('')
		}
		// No artwork means the small card, not a large one with a hole in it.
		expect(
			await page
				.locator('meta[name="twitter:card"]')
				.first()
				.getAttribute('content'),
		).toBe('summary')
		expect(await page.locator('meta[property="og:image"]').count()).toBe(0)
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
