// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub, data } from 'react-router'
import { expect, test, vi } from 'vitest'
import { QuickTrackControl } from './quick-track-control.tsx'

test('quick-track failures stay inline and a retry can succeed', async () => {
	const action = vi
		.fn()
		.mockResolvedValueOnce(
			data(
				{ ok: false as const, error: 'Tracking status not found' },
				{ status: 400 },
			),
		)
		.mockResolvedValue(
			data({
				ok: true as const,
				tracking: {
					mediaId: 'media-1',
					watchlistId: 'watchlist-1',
					status: 'watching',
					statusLabel: 'Watching',
					trackingStateId: 'tracking-1',
				},
			}),
		)
	const RoutesStub = createRoutesStub([
		{
			path: '/',
			Component() {
				return (
					<QuickTrackControl
						item={{
							id: 'media-1',
							kind: 'movie',
							title: 'Inline failure fixture',
							viewerTracking: null,
						}}
						watchlists={[
							{
								id: 'watchlist-1',
								name: 'watching',
								header: 'Watching',
								position: 1,
								type: { name: 'liveaction' },
							},
						]}
						isSignedIn
						loginRedirectTo="/"
					/>
				)
			},
		},
		{
			path: '/resources/quick-track',
			action,
		},
	])
	const user = userEvent.setup()

	render(<RoutesStub />)
	await user.click(
		screen.getByRole('button', { name: 'Track Inline failure fixture' }),
	)

	const alert = await screen.findByRole('alert')
	expect(alert).toHaveTextContent('Tracking status not found')
	expect(
		screen.getByRole('button', { name: 'Track Inline failure fixture' }),
	).toHaveAttribute('aria-describedby', alert.id)

	await user.click(
		screen.getByRole('button', { name: 'Track Inline failure fixture' }),
	)
	await waitFor(() =>
		expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
	)
	expect(
		screen.getByRole('button', { name: 'Update Inline failure fixture' }),
	).toHaveTextContent('Saved')
	expect(action).toHaveBeenCalledTimes(2)
})
