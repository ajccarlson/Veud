import { Link } from 'react-router'

export function SiteFooter() {
	return (
		<footer className="site-footer" aria-label="Site information">
			<p>
				<span className="site-footer-brand">Veud</span>
				<span aria-hidden="true"> · </span>
				Metadata from TMDB, MyAnimeList, AniList, and Trakt.
			</p>
			<Link prefetch="intent" to="/credits">
				About &amp; data sources
			</Link>
		</footer>
	)
}
