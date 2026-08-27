import { getFormProps, useForm } from '@conform-to/react'
import { useFetcher } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	THEME_ACTION,
	ThemeFormSchema,
	THEME_MODES,
	useThemeMode,
	type ThemeMode,
} from '#app/utils/theme.ts'

const MODE_LABEL: Record<ThemeMode, string> = {
	system: 'System',
	light: 'Light',
	dark: 'Dark',
}

const MODE_ICON: Record<ThemeMode, 'laptop' | 'sun' | 'moon'> = {
	system: 'laptop',
	light: 'sun',
	dark: 'moon',
}

const MODE_HINT: Record<ThemeMode, string> = {
	system: 'Follow whatever this device asks for.',
	light: 'Always light, whatever the device asks for.',
	dark: 'Always dark, whatever the device asks for.',
}

/**
 * The compact control, for the footer.
 *
 * It cycles rather than expanding, because the footer has no room for three
 * options and someone who wants to think about it has the settings page. The
 * label names the mode it is in, not the one it would move to — a button that
 * says "Dark" while the page is light is a coin toss to read.
 */
export function ThemeSwitch() {
	const fetcher = useFetcher()
	const [form] = useForm({ id: 'theme-switch' })
	const mode = useThemeMode()
	const nextMode =
		mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system'

	return (
		<fetcher.Form method="POST" action={THEME_ACTION} {...getFormProps(form)}>
			<input type="hidden" name="theme" value={nextMode} />
			<button
				type="submit"
				className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:underline"
				// The mode it is in is visible; the mode it moves to is not, and that
				// is the part a screen reader has to be told.
				aria-label={`Theme: ${MODE_LABEL[mode]}. Switch to ${MODE_LABEL[nextMode]}.`}
			>
				<Icon name={MODE_ICON[mode]} aria-hidden="true" />
				<span aria-hidden="true">{MODE_LABEL[mode]}</span>
			</button>
		</fetcher.Form>
	)
}

/**
 * The explicit control, for settings.
 *
 * Three named options rather than a cycle: this is the page someone opens
 * having decided they want a particular palette, and making them press a button
 * repeatedly to find it is the thing they came here to escape.
 */
export function ThemeChoice() {
	const fetcher = useFetcher()
	const [form] = useForm({ id: 'theme-choice' })
	const mode = useThemeMode()

	return (
		<fetcher.Form method="POST" action={THEME_ACTION} {...getFormProps(form)}>
			<fieldset className="space-y-2">
				<legend className="sr-only">Theme</legend>
				{THEME_MODES.map(option => (
					<div
						key={option}
						className="flex items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted/40"
					>
						<input
							type="radio"
							id={`theme-${option}`}
							name="theme"
							value={option}
							defaultChecked={mode === option}
							// Submitting on change means no separate save button, which is
							// right for a setting whose result is the page you are looking at.
							onChange={event => fetcher.submit(event.currentTarget.form)}
							className="mt-1.5"
						/>
						<label htmlFor={`theme-${option}`} className="cursor-pointer">
							<span className="flex items-center gap-2 font-semibold">
								<Icon name={MODE_ICON[option]} aria-hidden="true" />
								{MODE_LABEL[option]}
							</span>
							<span className="block text-sm text-muted-foreground">
								{MODE_HINT[option]}
							</span>
						</label>
					</div>
				))}
			</fieldset>
			<noscript>
				<button type="submit" className="mt-2 underline">
					Save theme
				</button>
			</noscript>
		</fetcher.Form>
	)
}

export { ThemeFormSchema }
