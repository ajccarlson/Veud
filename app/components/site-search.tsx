import { Form, Link, useLocation } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'

export function SiteSearch({
	aiAvailable,
	discoveryAiAvailable,
	isSignedIn,
}: {
	aiAvailable: boolean
	discoveryAiAvailable: boolean
	isSignedIn: boolean
}) {
	const location = useLocation()
	const searchParams = new URLSearchParams(location.search)
	const isDiscover = location.pathname === '/discover'
	const query = isDiscover ? (searchParams.get('q') ?? '') : ''
	const requestedKind = isDiscover ? (searchParams.get('kind') ?? 'all') : 'all'
	const kind = ['all', 'movie', 'tv', 'anime', 'manga'].includes(requestedKind)
		? requestedKind
		: 'all'
	const isMemoryMode = isDiscover && searchParams.get('mode') === 'memory'
	const isDescribeMode = isDiscover && searchParams.get('mode') === 'describe'
	const stateKey = `${query}:${kind}:${isMemoryMode ? 'memory' : isDescribeMode ? 'describe' : 'standard'}`

	return (
		<Form
			key={stateKey}
			action="/discover"
			method="get"
			role="search"
			className="site-search"
		>
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
				defaultValue={query}
			/>
			<label className="sr-only" htmlFor="site-search-kind">
				Media type
			</label>
			<select id="site-search-kind" name="kind" defaultValue={kind}>
				<option value="all">All</option>
				<option value="movie">Movies</option>
				<option value="tv">TV</option>
				<option value="anime">Anime</option>
				<option value="manga">Manga</option>
			</select>
			<button type="submit" className="site-search-submit" aria-label="Search">
				<Icon name="magnifying-glass" aria-hidden="true" />
			</button>
			<details
				className="site-search-advanced"
				data-active={isMemoryMode || isDescribeMode || undefined}
			>
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
							defaultChecked={isMemoryMode}
						/>
						<span>
							<strong>Tip of My Tongue</strong>
							<small>
								{aiAvailable
									? 'Describe it or add an image.'
									: isSignedIn
										? 'Search from remembered details.'
										: 'Search details · sign in for AI.'}
							</small>
						</span>
					</label>
					{isSignedIn ? (
						<Link
							to="/discover?mode=describe"
							className="site-search-discovery-link"
						>
							<Icon name="chat-bubble" aria-hidden="true" />
							<span>
								<strong>Describe what you want</strong>
								<small>
									{discoveryAiAvailable
										? 'Turn a request into editable filters.'
										: 'Currently unavailable.'}
								</small>
							</span>
						</Link>
					) : null}
				</div>
			</details>
		</Form>
	)
}
