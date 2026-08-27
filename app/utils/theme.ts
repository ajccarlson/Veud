import { parseWithZod } from '@conform-to/zod'
import { useFetchers, useRouteLoaderData } from 'react-router'
import { z } from 'zod'
import { useHints } from './client-hints.tsx'
import { useRequestInfo } from './request-info.ts'
import { type Theme } from './theme.server.ts'

/**
 * Choosing a palette.
 *
 * The preference is a cookie rather than a column on the member, which is what
 * lets a signed-out visitor pick one at all — and this site is readable signed
 * out, so that matters. It also means the choice belongs to the browser, not
 * the account: the same person on a phone and a laptop can want different
 * answers, and usually does.
 *
 * `system` is the absence of a choice. It follows the client hint, which is how
 * someone who has never opened this control gets the palette their device asked
 * for.
 */
export const THEME_MODES = ['system', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const ThemeFormSchema = z.object({
	theme: z.enum(THEME_MODES),
})

/**
 * Every theme form posts here rather than to whatever route it happens to be
 * rendered on. The control appears in the footer of every page and in settings,
 * and only the root action knows how to set the cookie.
 */
export const THEME_ACTION = '/'

/**
 * The mode being switched to, while the request is still in flight.
 *
 * Without this the palette would not change until the server answered, which
 * for a control whose entire job is visible is long enough to read as broken.
 */
export function useOptimisticThemeMode() {
	const fetchers = useFetchers()
	const themeFetcher = fetchers.find(
		fetcher => fetcher.formAction === THEME_ACTION,
	)

	if (themeFetcher && themeFetcher.formData) {
		const submission = parseWithZod(themeFetcher.formData, {
			schema: ThemeFormSchema,
		})

		if (submission.status === 'success') {
			return submission.value.theme
		}
	}
}

/** The palette to actually render in, once `system` has been resolved. */
export function useTheme(): Theme {
	const hints = useHints()
	const requestInfo = useRequestInfo()
	const optimisticMode = useOptimisticThemeMode()
	if (optimisticMode) {
		return optimisticMode === 'system' ? hints.theme : optimisticMode
	}
	return requestInfo.userPrefs.theme ?? hints.theme
}

/**
 * The mode as chosen, with `system` still meaning "whatever the device says".
 *
 * Reads the root loader directly rather than through `useRequestInfo`, which
 * throws when that data is absent. The control this feeds sits in the footer of
 * every page, so it has to render wherever the footer does — and "no preference
 * recorded" is a perfectly good answer, not a reason to take the page down.
 */
export function useThemeMode(): ThemeMode {
	const data = useRouteLoaderData('root') as
		{ requestInfo?: { userPrefs?: { theme?: Theme | null } } } | undefined
	const optimisticMode = useOptimisticThemeMode()
	return optimisticMode ?? data?.requestInfo?.userPrefs?.theme ?? 'system'
}
