// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import {
	ALL_MEDIA_TYPES,
	MediaTypeDropdown,
} from './search-add-watchlist-entry.tsx'

/**
 * The search-type control on the watchlist quick-add.
 *
 * It picks which TMDB endpoint the search hits, and only one of those returns
 * films and series together — so a control that can narrow but not widen makes
 * half the catalog unreachable for the rest of the session.
 */
function renderDropdown(selectedSearchType = ALL_MEDIA_TYPES) {
	const setSelectedSearchType = vi.fn()
	render(
		<MediaTypeDropdown
			columnParams={{ selectedSearchType, setSelectedSearchType }}
		/>,
	)
	return { setSelectedSearchType }
}

test('the search type can be widened again, not only narrowed', async () => {
	// Movie and TV Series were the only options. Choosing either searched that
	// endpoint alone, with no way back — which is why a film with a series of
	// the same name stopped being findable.
	const user = userEvent.setup()
	const { setSelectedSearchType } = renderDropdown('TV Series')

	await user.click(screen.getByRole('button', { name: /search type/i }))
	await user.click(screen.getByRole('menuitem', { name: ALL_MEDIA_TYPES }))

	expect(setSelectedSearchType).toHaveBeenCalledWith(ALL_MEDIA_TYPES)
})

test('both narrowing choices are still offered', async () => {
	const user = userEvent.setup()
	const { setSelectedSearchType } = renderDropdown()

	await user.click(screen.getByRole('button', { name: /search type/i }))
	await user.click(screen.getByRole('menuitem', { name: 'Movie' }))
	expect(setSelectedSearchType).toHaveBeenCalledWith('Movie')
})

test('the control says which type it is searching', async () => {
	// It used to read "Type", which names the control rather than its state.
	renderDropdown()
	expect(
		screen.getByRole('button', { name: `Search type: ${ALL_MEDIA_TYPES}` }),
	).toBeInTheDocument()
})
