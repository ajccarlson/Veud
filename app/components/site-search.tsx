import { Form } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'

export function SiteSearch({ aiAvailable }: { aiAvailable: boolean }) {
	return (
		<Form action="/discover" method="get" role="search" className="site-search">
			<label className="sr-only" htmlFor="site-search-query">
				Search movies, TV, anime, and manga
			</label>
			<input
				id="site-search-query"
				name="q"
				type="search"
				minLength={2}
				maxLength={500}
				required
				placeholder="Search media…"
				autoComplete="off"
			/>
			<label className="sr-only" htmlFor="site-search-kind">
				Media type
			</label>
			<select id="site-search-kind" name="kind" defaultValue="all">
				<option value="all">All</option>
				<option value="movie">Movies</option>
				<option value="tv">TV</option>
				<option value="anime">Anime</option>
				<option value="manga">Manga</option>
			</select>
			<button type="submit" className="site-search-submit" aria-label="Search">
				<Icon name="magnifying-glass" aria-hidden="true" />
			</button>
			<details className="site-search-advanced">
				<summary aria-label="Advanced search settings" title="Advanced search">
					<Icon name="magic-wand" aria-hidden="true" />
				</summary>
				<div className="site-search-advanced-panel">
					<label htmlFor="site-search-memory-mode">
						<span className="sr-only">Enable Tip of My Tongue search</span>
						<input
							id="site-search-memory-mode"
							type="checkbox"
							name="mode"
							value="memory"
							disabled={!aiAvailable}
						/>
						<span>
							<strong>Tip of My Tongue</strong>
							<small>
								{aiAvailable
									? 'Describe what you remember; AI will rank five catalog matches.'
									: 'Available when AI search is configured.'}
							</small>
						</span>
					</label>
				</div>
			</details>
		</Form>
	)
}
