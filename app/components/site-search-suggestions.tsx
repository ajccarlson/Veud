import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
	allResultsHref,
	moveSuggestionIndex,
	normalizeSuggestionQuery,
	suggestionHref,
	suggestionMeta,
	SUGGESTION_LIMIT,
	type SearchSuggestion,
	type SuggestionKind,
} from '#app/utils/search-suggestions.ts'

/**
 * Long enough that typing a word does not cost a request per letter, short
 * enough that the list feels like it is keeping up with the keyboard.
 */
const DEBOUNCE_MS = 180

export function SiteSearchSuggestions({
	inputId,
	kind,
}: {
	inputId: string
	kind: SuggestionKind
}) {
	const navigate = useNavigate()
	const listId = useId()
	const optionId = useId()
	const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState(false)
	const [activeIndex, setActiveIndex] = useState(-1)
	const containerRef = useRef<HTMLDivElement>(null)

	// The input belongs to the search form, so it is wired up here rather than
	// re-rendered: taking ownership of it would mean re-implementing the form
	// submit, the advanced modes, and the browser's own search-field behaviour.
	useEffect(() => {
		const input = document.getElementById(inputId)
		if (!(input instanceof HTMLInputElement)) return
		const onInput = () => {
			setQuery(input.value)
			setOpen(true)
			setActiveIndex(-1)
		}
		const onFocus = () => setOpen(true)
		input.addEventListener('input', onInput)
		input.addEventListener('focus', onFocus)
		return () => {
			input.removeEventListener('input', onInput)
			input.removeEventListener('focus', onFocus)
		}
	}, [inputId])

	// Fetch after the typing settles, and abort whatever is still in flight:
	// responses can arrive out of order, and a slow early one would otherwise
	// overwrite the results for what is on screen now.
	useEffect(() => {
		const wanted = normalizeSuggestionQuery(query)
		if (!wanted) {
			setSuggestions([])
			return
		}
		const controller = new AbortController()
		const timer = setTimeout(async () => {
			try {
				const params = new URLSearchParams({
					q: wanted,
					kind,
					limit: String(SUGGESTION_LIMIT),
				})
				const response = await fetch(
					`/resources/search-suggestions?${params.toString()}`,
					{
						signal: controller.signal,
						headers: { accept: 'application/json' },
					},
				)
				if (!response.ok) throw new Error(String(response.status))
				const payload = (await response.json()) as {
					suggestions?: SearchSuggestion[]
				}
				setSuggestions(
					Array.isArray(payload.suggestions) ? payload.suggestions : [],
				)
			} catch {
				// A failed suggestion is not worth interrupting anyone over — the
				// search bar still submits, which is the thing that has to work.
				if (!controller.signal.aborted) setSuggestions([])
			}
		}, DEBOUNCE_MS)
		return () => {
			clearTimeout(timer)
			controller.abort()
		}
	}, [query, kind])

	// Clicking anywhere else dismisses the list, including on the page behind it.
	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Node)) return
			if (containerRef.current?.contains(target)) return
			if (document.getElementById(inputId)?.contains(target)) return
			setOpen(false)
		}
		document.addEventListener('pointerdown', onPointerDown)
		return () => document.removeEventListener('pointerdown', onPointerDown)
	}, [open, inputId])

	// Arrow keys move through the list, Enter opens the highlighted title, and
	// Escape puts the typed text back. With nothing highlighted, Enter is left
	// alone so the form submits and the full results page opens.
	useEffect(() => {
		const input = document.getElementById(inputId)
		if (!(input instanceof HTMLInputElement)) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (!suggestions.length) return
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault()
				setOpen(true)
				setActiveIndex(current =>
					moveSuggestionIndex(
						current,
						suggestions.length,
						event.key === 'ArrowDown' ? 1 : -1,
					),
				)
				return
			}
			if (event.key === 'Escape') {
				setOpen(false)
				setActiveIndex(-1)
				return
			}
			if (event.key === 'Enter' && activeIndex >= 0) {
				const chosen = suggestions[activeIndex]
				if (!chosen) return
				event.preventDefault()
				setOpen(false)
				void navigate(suggestionHref(chosen))
			}
		}
		input.addEventListener('keydown', onKeyDown)
		return () => input.removeEventListener('keydown', onKeyDown)
	}, [inputId, suggestions, activeIndex, navigate])

	// Announce the listbox on the input itself, so assistive technology sees a
	// combobox rather than a plain field with something unexplained beneath it.
	useEffect(() => {
		const input = document.getElementById(inputId)
		if (!(input instanceof HTMLInputElement)) return
		const visible = open && suggestions.length > 0
		input.setAttribute('role', 'combobox')
		input.setAttribute('aria-expanded', visible ? 'true' : 'false')
		input.setAttribute('aria-controls', listId)
		input.setAttribute('aria-autocomplete', 'list')
		if (visible && activeIndex >= 0) {
			input.setAttribute('aria-activedescendant', `${optionId}-${activeIndex}`)
		} else {
			input.removeAttribute('aria-activedescendant')
		}
	}, [inputId, open, suggestions.length, activeIndex, listId, optionId])

	const normalized = normalizeSuggestionQuery(query)
	if (!open || !normalized || !suggestions.length) return null

	return (
		<div className="site-search-suggestions" ref={containerRef}>
			<ul id={listId} role="listbox" aria-label="Search suggestions">
				{suggestions.map((suggestion, index) => (
					<li
						key={suggestion.id}
						id={`${optionId}-${index}`}
						role="option"
						aria-selected={index === activeIndex}
						data-active={index === activeIndex || undefined}
					>
						<a
							href={suggestionHref(suggestion)}
							onMouseEnter={() => setActiveIndex(index)}
							onClick={() => setOpen(false)}
						>
							{suggestion.thumbnail ? (
								<img src={suggestion.thumbnail} alt="" loading="lazy" />
							) : (
								<span
									className="site-search-suggestion-blank"
									aria-hidden="true"
								/>
							)}
							<span className="site-search-suggestion-text">
								<strong>{suggestion.title}</strong>
								<small>{suggestionMeta(suggestion)}</small>
							</span>
						</a>
					</li>
				))}
			</ul>
			<a
				className="site-search-suggestions-all"
				href={allResultsHref(normalized, kind)}
				onClick={() => setOpen(false)}
			>
				See all results for “{normalized}”
			</a>
		</div>
	)
}
