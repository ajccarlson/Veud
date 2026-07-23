import { Link } from 'react-router'

export function SiteFooter() {
	return (
		<footer className="site-footer" aria-label="Site information">
			<p>
				<span className="site-footer-brand">Veud</span>
				<span aria-hidden="true"> · </span>
				Metadata from TMDB, MyAnimeList, AniList, and Trakt.
			</p>
			<span>
				<Link prefetch="intent" to="/status">
					Service status
				</Link>
				<span aria-hidden="true"> · </span>
				<Link prefetch="intent" to="/credits">
					About &amp; data sources
				</Link>
			</span>
		</footer>
	)
}
