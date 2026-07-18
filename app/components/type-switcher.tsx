import { type ReactNode } from 'react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

export type SwitcherOption = { key: string; label: ReactNode }

/**
 * The left-arrow / dropdown / right-arrow selector used across the profile page
 * (chart picker, list-type picker, calendar year & month). It renders only the
 * `.user-landing-selection-nav-container` row — callers keep any surrounding
 * layout (e.g. the secondary nav container + spacer).
 *
 * `variant` swaps the arrow/trigger classes: `primary` for the main greenish
 * controls, `secondary` for the mint-accented ones.
 */
const VARIANT_CLASSES = {
	primary: {
		left: 'user-landing-nav-arrow user-landing-left-arrow',
		right: 'user-landing-nav-arrow user-landing-right-arrow',
		trigger: 'user-landing-dropdown-trigger',
	},
	secondary: {
		left: 'user-landing-nav-arrow user-landing-secondary-left-arrow',
		right: 'user-landing-nav-arrow user-landing-secondary-right-arrow',
		trigger: 'user-landing-secondary-dropdown-trigger',
	},
} as const

export function TypeSwitcher({
	options,
	index,
	onIndexChange,
	variant = 'primary',
}: {
	options: SwitcherOption[]
	index: number
	onIndexChange: (index: number) => void
	variant?: 'primary' | 'secondary'
}) {
	if (options.length === 0) return null
	const classes = VARIANT_CLASSES[variant]
	const current = options[index]

	return (
		<div className="user-landing-selection-nav-container">
			<button
				type="button"
				onClick={() =>
					onIndexChange(index === 0 ? options.length - 1 : index - 1)
				}
			>
				<Icon name="triangle-left" className={classes.left} />
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<div className={classes.trigger}>{current?.label}</div>
				</DropdownMenuTrigger>
				<DropdownMenuPortal>
					<DropdownMenuContent
						sideOffset={8}
						align="start"
						className="user-landing-dropdown-item-container"
					>
						{options.map((option, optionIndex) =>
							optionIndex === index ? null : (
								<DropdownMenuItem
									className="user-landing-dropdown-item"
									key={option.key}
									onClick={() => onIndexChange(optionIndex)}
								>
									{option.label}
								</DropdownMenuItem>
							),
						)}
					</DropdownMenuContent>
				</DropdownMenuPortal>
			</DropdownMenu>
			<button
				type="button"
				onClick={() => onIndexChange((index + 1) % options.length)}
			>
				<Icon name="triangle-right" className={classes.right} />
			</button>
		</div>
	)
}
