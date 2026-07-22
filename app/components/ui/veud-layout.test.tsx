// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import {
	VeudEmptyState,
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from './veud-layout.tsx'

test('provides consistent semantic page, panel, and empty-state structure', () => {
	render(
		<VeudPage width="narrow">
			<VeudPageHeader
				eyebrow="Discover"
				title="A shared visual language"
				description="Readable at every width."
			/>
			<VeudPanel aria-label="Example panel">Panel content</VeudPanel>
			<VeudEmptyState title="Nothing here yet">
				Try another filter.
			</VeudEmptyState>
		</VeudPage>,
	)

	expect(
		screen.getByRole('heading', { level: 1, name: 'A shared visual language' }),
	).toBeInTheDocument()
	expect(screen.getByRole('region', { name: 'Example panel' })).toHaveClass(
		'bg-veud-surface',
	)
	expect(
		screen.getByRole('heading', { level: 2, name: 'Nothing here yet' }),
	).toBeInTheDocument()
})
