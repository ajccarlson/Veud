import * as React from 'react'

import { cn } from '#app/utils/misc.tsx'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
	({ className, ...props }, ref) => {
		return (
			<textarea
				className={cn(
					'flex min-h-[80px] w-full rounded-xl border border-veud-border/65 bg-veud-ink/65 px-3 py-2 text-sm text-veud-cream shadow-inner shadow-black/15 ring-offset-veud-canvas placeholder:text-veud-sage focus-visible:border-veud-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veud-mint/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid]:border-input-invalid',
					className,
				)}
				ref={ref}
				{...props}
			/>
		)
	},
)
Textarea.displayName = 'Textarea'

export { Textarea }
