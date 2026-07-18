/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ProfileAbout } from './profile-about.tsx'

test('renders CommonMark content and hardens external links', () => {
	render(
		<ProfileAbout bio={'## Hello **there**\n\n[Veud](https://example.com)'} />,
	)

	expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
	expect(screen.getByRole('heading', { name: 'Hello there' })).toBeInTheDocument()
	expect(screen.getByRole('link', { name: 'Veud' })).toHaveAttribute(
		'rel',
		'nofollow noopener noreferrer',
	)
	expect(screen.getByRole('link', { name: 'Veud' })).toHaveAttribute(
		'target',
		'_blank',
	)
})

test('loads markdown images lazily without sending a referrer', () => {
	render(<ProfileAbout bio={'![Cover](https://example.com/cover.jpg)'} />)

	expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute(
		'loading',
		'lazy',
	)
	expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute(
		'referrerpolicy',
		'no-referrer',
	)
})

test('does not create raw HTML elements from a bio', () => {
	const { container } = render(
		<ProfileAbout bio={'Before<script>alert("xss")</script>After'} />,
	)

	expect(container.querySelector('script')).not.toBeInTheDocument()
})

test('renders nothing for an empty bio', () => {
	const { container } = render(<ProfileAbout bio={null} />)
	expect(container).toBeEmptyDOMElement()
})
