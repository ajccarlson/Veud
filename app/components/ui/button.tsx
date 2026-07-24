import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '#app/utils/misc.tsx'

const buttonVariants = cva(
	'inline-flex items-center justify-center rounded-xl border border-transparent text-sm font-bold tracking-[0.01em] ring-offset-veud-canvas transition-[color,background-color,border-color,box-shadow,transform] outline-none focus-visible:ring-2 focus-within:ring-2 ring-veud-mint ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
	{
		variants: {
			variant: {
				default:
					'border-veud-amber/70 bg-veud-amber text-veud-ink shadow-md shadow-black/15 hover:border-veud-gold hover:bg-veud-gold hover:shadow-lg hover:shadow-black/20',
				destructive:
					'border-veud-danger/55 bg-destructive text-destructive-foreground shadow-md shadow-black/15 hover:bg-destructive/80',
				outline:
					'border-veud-border/80 bg-veud-ink/50 text-veud-cream hover:border-veud-mint/70 hover:bg-veud-mint/10 hover:text-veud-mint',
				secondary:
					'border-veud-border/45 bg-veud-surface text-veud-cream shadow-sm shadow-black/10 hover:border-veud-mint/55 hover:bg-veud-surface-raised',
				ghost:
					'text-veud-copy hover:border-veud-border/35 hover:bg-veud-mint/10 hover:text-veud-mint',
				link: 'text-veud-gold underline-offset-4 hover:text-veud-yellow hover:underline',
			},
			size: {
				default: 'h-10 px-4 py-2',
				wide: 'px-24 py-5',
				sm: 'h-9 rounded-lg px-3',
				lg: 'h-11 px-8',
				pill: 'px-12 py-3 leading-3',
				icon: 'h-10 w-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
)

export interface ButtonProps
	extends
		React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button'
		return (
			<Comp
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		)
	},
)
Button.displayName = 'Button'

export { Button, buttonVariants }
