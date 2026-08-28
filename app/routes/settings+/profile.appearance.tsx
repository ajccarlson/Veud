import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { ThemeChoice } from '#app/components/theme-switch.tsx'
import { Icon } from '#app/components/ui/icon.tsx'

export const handle: SEOHandle & { breadcrumb: React.ReactNode } = {
	breadcrumb: <Icon name="sun">Appearance</Icon>,
	getSitemapEntries: () => null,
}

/**
 * Where the palette is chosen.
 *
 * No loader and no action: the preference is a cookie the root action sets, so
 * this page is a control and nothing else. That is also why it does not require
 * a signed-in member — the setting belongs to the browser, and the footer
 * carries the same choice for anyone who never comes here.
 */
export default function AppearanceSettingsRoute() {
	return (
		<div className="space-y-4">
			<div>
				<h2 className="text-lg font-semibold">Appearance</h2>
				<p className="text-sm text-muted-foreground">
					This is remembered by this browser, so you can read light on a laptop
					and dark on a phone.
				</p>
			</div>
			<ThemeChoice />
		</div>
	)
}
