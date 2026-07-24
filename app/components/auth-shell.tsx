import type * as React from 'react'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'
import { cn } from '#app/utils/misc.tsx'

export function AuthShell({
	title,
	description,
	children,
	className,
}: {
	title: React.ReactNode
	description?: React.ReactNode
	children: React.ReactNode
	className?: string
}) {
	return (
		<VeudPage
			width="form"
			className="flex flex-1 items-start justify-center py-10 sm:py-16"
		>
			<VeudPanel
				className={cn(
					'w-full max-w-xl overflow-hidden p-0 shadow-2xl shadow-black/20',
					className,
				)}
			>
				<VeudPageHeader
					eyebrow="Veud account"
					title={title}
					description={description}
					className="rounded-none border-x-0 border-t-0 shadow-none"
				/>
				<div className="p-5 sm:p-8">{children}</div>
			</VeudPanel>
		</VeudPage>
	)
}
