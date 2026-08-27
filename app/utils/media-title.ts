/**
 * What to call a title on screen.
 *
 * MAL's canonical title for anime and manga is the romaji one — "Shingeki no
 * Kyojin" rather than "Attack on Titan" — and which of those someone wants is a
 * preference, not a fact about the work. Every surface that renders a title
 * goes through here so the answer is the same everywhere: a list row, a search
 * suggestion and a title page must not disagree about what a thing is called.
 *
 * TMDB titles are unaffected. Films and series are already stored under their
 * English title, so there is nothing to prefer.
 */

export const TITLE_LANGUAGES = ['default', 'english'] as const
export type TitleLanguage = (typeof TITLE_LANGUAGES)[number]

export function normalizeTitleLanguage(value: unknown): TitleLanguage {
	return TITLE_LANGUAGES.includes(value as TitleLanguage)
		? (value as TitleLanguage)
		: 'default'
}

/** The kinds whose canonical title is not English to begin with. */
function hasEnglishAlternate(kind: string) {
	return kind === 'anime' || kind === 'manga'
}

export type TitledMedia = {
	kind: string
	title?: string | null
	englishTitle?: string | null
}

/**
 * The title to display, with the fallback chain that keeps a row readable.
 *
 * English is preferred only when it was asked for, only for the kinds that have
 * an alternate, and only when one was actually stored — MAL supplies it for
 * some titles and not others, so falling back to the canonical title is the
 * common case rather than the exception.
 *
 * The `Untitled <kind>` ending is the same one that was written out at every
 * call site before this existed; keeping it here is what stops the surfaces
 * drifting apart.
 */
export function resolveDisplayTitle(
	media: TitledMedia,
	preference: TitleLanguage = 'default',
) {
	if (preference === 'english' && hasEnglishAlternate(media.kind)) {
		const english = media.englishTitle?.trim()
		if (english) return english
	}
	return media.title?.trim() || `Untitled ${media.kind}`
}
