// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, test } from 'vitest'
import { UpcomingData } from './_upcoming.tsx'

test('uses the full day count when the home loader returns a bounded preview', () => {
	const items = Array.from({ length: 3 }, (_, index) => ({
		id: `release-${index}`,
		mediaId: `media-${index}`,
		title: `Release ${index}`,
		kind: 'anime',
		type: 'TV',
		imageUrl: null,
		releaseAt: `2026-07-28T1${index}:00:00.000Z`,
		allDay: false,
		eventLabel: `Episode ${index + 1}`,
		eventName: null,
		trackerCount: 1,
		viewerTracking: { statusLabel: 'Watching', score: null },
	}))

	render(
		<MemoryRouter>
			<UpcomingData
				calendar={{
					start: '2026-07-27',
					timeZone: 'UTC',
					total: 10,
					days: [{ date: '2026-07-28', items, totalCount: 10 }],
				}}
			/>
		</MemoryRouter>,
	)

	expect(screen.getAllByRole('article')).toHaveLength(3)
	expect(screen.getByText('+7 more on the full calendar')).toBeInTheDocument()
})
