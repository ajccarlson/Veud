import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const mediaPage = fs.readFileSync(
	path.join(process.cwd(), 'app/routes/media+/$mediaId.tsx'),
	'utf8',
)

/** The page with comments removed, so a credit in a comment cannot satisfy a test. */
const rendered = mediaPage
	.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/^\s*\/\/.*$/gm, '')

test('the streaming surface credits JustWatch in what the viewer sees', () => {
	// TMDB supplies this data from JustWatch and requires the credit. A mention
	// in a source comment is not a credit, so the assertion runs against the page
	// with comments stripped.
	expect(rendered).toMatch(/Streaming availability from JustWatch/)
})

test('the only destination is the link the provider returned', () => {
	// Constructing a provider URL, or linking anywhere other than the attributed
	// link, breaks the terms the data is supplied under.
	const section = mediaPage.slice(
		mediaPage.indexOf('Where to watch'),
		mediaPage.indexOf('Streaming availability from JustWatch'),
	)
	expect(section).toContain('href={offer.link}')
	expect(section).not.toMatch(/href=\{`http/)
	expect(section).not.toMatch(/href="http/)
})

test('expired availability is never selected for display', () => {
	// Availability is regional and changes constantly; a stale row must not be
	// shown as though it were current.
	expect(mediaPage).toMatch(
		/watchAvailability:\s*\{[\s\S]{0,120}expiresAt: \{ gt: new Date\(\) \}/,
	)
})

test('offer kinds are shown in words, not TMDB field names', () => {
	expect(mediaPage).toMatch(/flatrate: 'Subscription'/)
	expect(mediaPage).toMatch(/ads: 'Free with ads'/)
})
