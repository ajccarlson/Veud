// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import CreditsRoute from './credits.tsx'

test('publishes provider attribution and the required TMDB notice', () => {
	render(<CreditsRoute />)

	expect(
		screen.getByRole('heading', { name: 'Data sources & credits' }),
	).toBeInTheDocument()
	expect(
		screen.getByText(
			'This product uses the TMDB API but is not endorsed or certified by TMDB.',
		),
	).toBeInTheDocument()
	expect(
		screen.getByRole('img', { name: 'The Movie Database (TMDB)' }),
	).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml/))
	for (const provider of ['MyAnimeList', 'AniList', 'Trakt']) {
		expect(screen.getByRole('link', { name: provider })).toHaveAttribute(
			'target',
			'_blank',
		)
	}
})
