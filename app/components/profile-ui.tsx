import { type ReactNode } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon, type IconName } from '#app/components/ui/icon.tsx'

export function ProfilePageHeader({
	eyebrow,
	title,
	description,
	meta,
	action,
}: {
	eyebrow?: string
	title: string
	description?: ReactNode
	meta?: ReactNode
	action?: ReactNode
}) {
	return (
		<header className="user-landing-page-header">
			<div className="user-landing-page-heading">
				{eyebrow ? (
					<span className="user-landing-page-eyebrow">{eyebrow}</span>
				) : null}
				<h1>{title}</h1>
				{description ? <p>{description}</p> : null}
			</div>
			{meta || action ? (
				<div className="user-landing-page-actions">
					{meta ? <span className="user-landing-page-meta">{meta}</span> : null}
					{action}
				</div>
			) : null}
		</header>
	)
}

export function ProfileEmptyState({
	icon = 'archive',
	title,
	description,
	action,
	tone = 'default',
}: {
	icon?: IconName
	title: string
	description: ReactNode
	action?: ReactNode
	tone?: 'default' | 'error'
}) {
	return (
		<section
			className="user-landing-empty-state"
			data-tone={tone}
			role={tone === 'error' ? 'alert' : undefined}
		>
			<div className="user-landing-empty-icon" aria-hidden="true">
				<Icon name={icon} size="lg" />
			</div>
			<h2>{title}</h2>
			<p>{description}</p>
			{action ? (
				<div className="user-landing-empty-action">{action}</div>
			) : null}
		</section>
	)
}

export function ProfileTabErrorBoundary() {
	const error = useRouteError()
	const description = isRouteErrorResponse(error)
		? error.status === 404
			? 'This profile section is no longer available.'
			: `The server returned ${error.status}. Please try this section again.`
		: 'An unexpected error prevented this profile section from loading.'

	return (
		<ProfileEmptyState
			icon="exclamation-triangle"
			title="This section could not load"
			description={description}
			tone="error"
			action={
				<Button
					type="button"
					variant="outline"
					onClick={() => window.location.reload()}
				>
					Try again
				</Button>
			}
		/>
	)
}
