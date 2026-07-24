import * as React from 'react'

import { cn } from '#app/utils/misc.tsx'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className, type, ...props }, ref) => {
		return (
			<input
				type={type}
				className={cn(
					'flex h-10 w-full rounded-xl border border-veud-border/65 bg-veud-ink/65 px-3 py-2 text-sm text-veud-cream shadow-inner shadow-black/15 ring-offset-veud-canvas file:border-0 file:bg-transparent file:text-sm file:font-bold file:text-veud-mint placeholder:text-veud-sage focus-visible:border-veud-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veud-mint/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid]:border-input-invalid',
					className,
				)}
				ref={ref}
				{...props}
			/>
		)
	},
)
Input.displayName = 'Input'

export { Input }
