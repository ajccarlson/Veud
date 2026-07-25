// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { ProfilePeriodSelect, ProfileSegmentedFilter } from './profile-ui.tsx'

test('profile media filter exposes and updates its active choice', () => {
	function Example() {
		const [value, setValue] = useState('all')
		return (
			<ProfileSegmentedFilter
				label="Filter activity by media type"
				options={[
					{ key: 'all', label: 'All' },
					{ key: 'anime', label: 'Anime' },
				]}
				value={value}
				onValueChange={setValue}
			/>
		)
	}

	render(<Example />)

	const all = screen.getByRole('button', { name: 'All' })
	const anime = screen.getByRole('button', { name: 'Anime' })
	expect(
		screen.getByRole('group', { name: 'Filter activity by media type' }),
	).toBeInTheDocument()
	expect(all).toHaveAttribute('aria-pressed', 'true')
	expect(anime).toHaveAttribute('aria-pressed', 'false')

	fireEvent.click(anime)

	expect(all).toHaveAttribute('aria-pressed', 'false')
	expect(anime).toHaveAttribute('aria-pressed', 'true')
})

test('profile period select reports the chosen calendar value', () => {
	const onValueChange = vi.fn()
	render(
		<ProfilePeriodSelect
			label="Month"
			value="1"
			options={[
				{ key: '1', label: 'January' },
				{ key: '2', label: 'February' },
			]}
			onValueChange={onValueChange}
		/>,
	)

	fireEvent.change(screen.getByRole('combobox', { name: 'Month' }), {
		target: { value: '2' },
	})

	expect(onValueChange).toHaveBeenCalledWith('2')
})
