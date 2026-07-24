import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '#app/utils/misc.tsx'

const pageVariants = cva(
	'veud-page mx-auto w-full space-y-7 px-4 py-6 text-veud-cream sm:px-6 sm:py-8 lg:px-8',
	{
		variants: {
			width: {
				wide: 'max-w-7xl',
				default: 'max-w-6xl',
				narrow: 'max-w-5xl',
				form: 'max-w-3xl',
			},
		},
		defaultVariants: { width: 'wide' },
	},
)

export interface VeudPageProps
	extends
		React.HTMLAttributes<HTMLElement>,
		VariantProps<typeof pageVariants> {}

export const VeudPage = React.forwardRef<HTMLElement, VeudPageProps>(
	({ className, width, ...props }, ref) => (
		<main
			ref={ref}
			className={cn(pageVariants({ width }), className)}
			{...props}
		/>
	),
)
VeudPage.displayName = 'VeudPage'

export function VeudPageHeader({
	eyebrow,
	title,
	description,
	actions,
	className,
}: {
	eyebrow?: React.ReactNode
	title: React.ReactNode
	description?: React.ReactNode
	actions?: React.ReactNode
	className?: string
}) {
	return (
		<header
			className={cn(
				'veud-page-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
				className,
			)}
		>
			<div className="max-w-3xl space-y-2">
				{eyebrow ? (
					<p className="text-xs font-black uppercase tracking-[0.2em] text-veud-mint sm:text-sm">
						{eyebrow}
					</p>
				) : null}
				<h1 className="text-3xl font-[var(--veud-font-display)] font-bold leading-tight tracking-[-0.025em] text-veud-cream sm:text-4xl">
					{title}
				</h1>
				{description ? (
					<div className="text-sm leading-6 text-veud-copy sm:text-base sm:leading-7">
						{description}
					</div>
				) : null}
			</div>
			{actions ? <div className="shrink-0">{actions}</div> : null}
		</header>
	)
}

const panelVariants = cva('rounded-2xl border p-4 sm:p-5', {
	variants: {
		tone: {
			default: 'border-veud-border bg-veud-surface shadow-lg shadow-black/10',
			quiet: 'border-veud-border/60 bg-veud-canvas',
			warm: 'border-veud-amber/60 bg-veud-surface-raised',
			dashed: 'border-dashed border-veud-border bg-veud-surface',
		},
	},
	defaultVariants: { tone: 'default' },
})

export interface VeudPanelProps
	extends
		React.HTMLAttributes<HTMLElement>,
		VariantProps<typeof panelVariants> {}

export const VeudPanel = React.forwardRef<HTMLElement, VeudPanelProps>(
	({ className, tone, ...props }, ref) => (
		<section
			ref={ref}
			className={cn(panelVariants({ tone }), className)}
			{...props}
		/>
	),
)
VeudPanel.displayName = 'VeudPanel'

export function VeudEmptyState({
	title,
	children,
	action,
	className,
}: {
	title: React.ReactNode
	children?: React.ReactNode
	action?: React.ReactNode
	className?: string
}) {
	return (
		<VeudPanel
			tone="dashed"
			className={cn('px-6 py-12 text-center sm:py-16', className)}
		>
			<h2 className="text-xl font-black text-veud-yellow">{title}</h2>
			{children ? (
				<div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-veud-mint">
					{children}
				</div>
			) : null}
			{action ? <div className="mt-5">{action}</div> : null}
		</VeudPanel>
	)
}
