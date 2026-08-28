import { Link } from 'react-router'
import { ThemeSwitch } from '#app/components/theme-switch.tsx'

export function SiteFooter() {
	return (
		<footer className="site-footer" aria-label="Site information">
			<p>
				<span className="site-footer-brand">Veud</span>
				<span aria-hidden="true"> · </span>
				Metadata from TMDB, MyAnimeList, AniList, and Trakt.
			</p>
			<span>
				<Link prefetch="intent" to="/support">
					Support
				</Link>
				<span aria-hidden="true"> · </span>
				<Link prefetch="intent" to="/status">
					Service status
				</Link>
				<span aria-hidden="true"> · </span>
				<Link prefetch="intent" to="/credits">
					About &amp; data sources
				</Link>
				<span aria-hidden="true"> · </span>
				<Link prefetch="intent" to="/terms">
					Terms
				</Link>
				<span aria-hidden="true"> · </span>
				<Link prefetch="intent" to="/privacy">
					Privacy
				</Link>
			</span>
			{/* The palette is a cookie, not an account setting, so it has to be
			    reachable signed out — most of this site is readable without an
			    account. Settings has the full control; this is the one that travels. */}
			<ThemeSwitch />
		</footer>
	)
}
