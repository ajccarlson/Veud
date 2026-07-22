// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import { SiteFooter } from './site-footer.tsx'

test('keeps provider attribution reachable outside community navigation', () => {
	render(
		<MemoryRouter>
			<SiteFooter />
		</MemoryRouter>,
	)

	expect(
		screen.getByRole('contentinfo', { name: 'Site information' }),
	).toHaveTextContent('Metadata from TMDB, MyAnimeList, AniList, and Trakt.')
	expect(
		screen.getByRole('link', { name: 'About & data sources' }),
	).toHaveAttribute('href', '/credits')
})
