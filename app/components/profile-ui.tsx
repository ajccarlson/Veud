import { type ReactNode } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon, type IconName } from '#app/components/ui/icon.tsx'

export type ProfileFilterOption = {
	key: string
	label: string
}

export function ProfileOptionNavigator({
	label,
	options,
	value,
	onValueChange,
}: {
	label: string
	options: ProfileFilterOption[]
	value: string
	onValueChange: (value: string) => void
}) {
	if (options.length === 0) return null

	const selectedIndex = Math.max(
		0,
		options.findIndex(option => option.key === value),
	)
	const previousIndex =
		selectedIndex === 0 ? options.length - 1 : selectedIndex - 1
	const nextIndex = (selectedIndex + 1) % options.length

	return (
		<div className="user-landing-option-navigator">
			<span className="user-landing-control-label">{label}</span>
			<div role="group" aria-label={`${label} navigation`}>
				<button
					type="button"
					className="user-landing-option-navigator-button"
					aria-label={`Previous ${label.toLowerCase()}`}
					title={options[previousIndex]?.label}
					onClick={() => onValueChange(options[previousIndex]?.key ?? value)}
				>
					<Icon name="chevron-left" aria-hidden="true" />
				</button>
				<label className="user-landing-option-navigator-select">
					<span className="sr-only">{label}</span>
					<select
						aria-label={label}
						value={options[selectedIndex]?.key}
						onChange={event => onValueChange(event.currentTarget.value)}
					>
						{options.map(option => (
							<option key={option.key} value={option.key}>
								{option.label}
							</option>
						))}
					</select>
					<Icon name="triangle-down" aria-hidden="true" />
				</label>
				<button
					type="button"
					className="user-landing-option-navigator-button"
					aria-label={`Next ${label.toLowerCase()}`}
					title={options[nextIndex]?.label}
					onClick={() => onValueChange(options[nextIndex]?.key ?? value)}
				>
					<Icon name="chevron-right" aria-hidden="true" />
				</button>
			</div>
		</div>
	)
}

export function ProfileSegmentedFilter({
	label,
	options,
	value,
	onValueChange,
}: {
	label: string
	options: ProfileFilterOption[]
	value: string
	onValueChange: (value: string) => void
}) {
	return (
		<div
			className="user-landing-segmented-filter"
			role="group"
			aria-label={label}
		>
			{options.map(option => {
				const selected = option.key === value
				return (
					<button
						key={option.key}
						type="button"
						className="user-landing-segmented-filter-option"
						aria-pressed={selected}
						data-active={selected || undefined}
						onClick={() => onValueChange(option.key)}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}

export function ProfilePeriodSelect({
	label,
	value,
	options,
	onValueChange,
}: {
	label: string
	value: string
	options: ProfileFilterOption[]
	onValueChange: (value: string) => void
}) {
	return (
		<label className="user-landing-period-field">
			<span>{label}</span>
			<span className="user-landing-period-select-shell">
				<select
					aria-label={label}
					value={value}
					onChange={event => onValueChange(event.currentTarget.value)}
				>
					{options.map(option => (
						<option key={option.key} value={option.key}>
							{option.label}
						</option>
					))}
				</select>
				<Icon name="triangle-down" aria-hidden="true" />
			</span>
		</label>
	)
}

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
