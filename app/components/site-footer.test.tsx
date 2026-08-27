// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { SiteFooter } from './site-footer.tsx'

// A data router, not a MemoryRouter: the footer now carries the theme control,
// which submits with a fetcher, and fetchers only exist under one of these.
function renderFooter(
	requestInfo: unknown = { userPrefs: { theme: null }, origin: '' },
) {
	const router = createMemoryRouter([
		{
			id: 'root',
			path: '/',
			loader: () => ({ requestInfo }),
			Component: SiteFooter,
		},
	])
	return render(<RouterProvider router={router} />)
}

test('keeps provider attribution reachable outside community navigation', async () => {
	renderFooter()

	expect(
		await screen.findByRole('contentinfo', { name: 'Site information' }),
	).toHaveTextContent('Metadata from TMDB, MyAnimeList, AniList, and Trakt.')
	expect(
		screen.getByRole('link', { name: 'About & data sources' }),
	).toHaveAttribute('href', '/credits')
	expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
		'href',
		'/terms',
	)
	expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
		'href',
		'/privacy',
	)
})

test('carries the theme control, so a signed-out visitor keeps the choice', async () => {
	// Most of this site is readable signed out and the preference is a cookie,
	// so putting the control only behind a login would have taken the palette
	// away from everyone reading it that way.
	renderFooter({ userPrefs: { theme: 'light' }, origin: '' })

	const control = await screen.findByRole('button', { name: /theme:/i })
	// Names the mode it is in, then where pressing it goes — a button labelled
	// only "Dark" while the page is light is a coin toss to read.
	expect(control).toHaveAccessibleName('Theme: Light. Switch to Dark.')
})

test('the control renders even where the root loader said nothing', async () => {
	// The footer is on every page, including ones reached when the theme
	// preference never loaded. No preference is an answer, not an error.
	renderFooter(undefined)

	expect(
		await screen.findByRole('button', { name: /theme:/i }),
	).toHaveAccessibleName('Theme: System. Switch to Light.')
})
