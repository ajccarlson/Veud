import { type MetaFunction } from 'react-router'
import tmdbLogo from '#app/components/ui/icons/tmdb-long.svg'
import {
	VeudPage,
	VeudPageHeader,
	VeudPanel,
} from '#app/components/ui/veud-layout.tsx'

export const meta: MetaFunction = () => [
	{ title: 'Data sources & credits | Veud' },
	{
		name: 'description',
		content:
			'Learn which media data providers Veud uses and how provider-derived data is attributed.',
	},
]

const providers = [
	{
		name: 'MyAnimeList',
		href: 'https://myanimelist.net',
		description:
			'Anime and manga identities, titles, artwork, scores, relationships, and catalog metadata.',
	},
	{
		name: 'AniList',
		href: 'https://anilist.co',
		description:
			'Supplemental anime airing schedules and streaming episode information.',
	},
	{
		name: 'Trakt',
		href: 'https://trakt.tv',
		description:
			'Optional account connection and public profile identity information.',
	},
]

export default function CreditsRoute() {
	return (
		<VeudPage width="narrow" className="space-y-8">
			<VeudPageHeader
				eyebrow="About Veud"
				title="Data sources & credits"
				description={
					<p>
						Veud combines user-owned tracking and reviews with metadata supplied
						by independent media-data providers. Provider data keeps its source
						identity so it can be refreshed, corrected, or removed without
						deleting member history.
					</p>
				}
			/>

			<VeudPanel className="space-y-4 p-6">
				<a
					href="https://www.themoviedb.org"
					rel="noreferrer"
					target="_blank"
					className="inline-flex rounded-lg bg-white p-4 transition hover:bg-[#e8fbff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a2ffd5]"
				>
					<img
						alt="The Movie Database (TMDB)"
						className="h-auto w-52 max-w-full"
						loading="lazy"
						src={tmdbLogo}
					/>
				</a>
				<h2 className="text-2xl font-black text-veud-cream">
					The Movie Database
				</h2>
				<p className="leading-7 text-veud-copy">
					Movie and television identities, artwork, scores, release information,
					and catalog metadata are supplied by TMDB.
				</p>
				<p className="rounded-xl border border-[#01b4e4]/60 bg-[#0d253f] p-4 font-semibold leading-7 text-white">
					This product uses the TMDB API but is not endorsed or certified by
					TMDB.
				</p>
			</VeudPanel>

			<section
				className="grid gap-4 md:grid-cols-3"
				aria-label="Other providers"
			>
				{providers.map(provider => (
					<VeudPanel key={provider.name} className="space-y-3">
						<h2 className="text-xl font-black text-veud-amber">
							<a
								href={provider.href}
								rel="noreferrer"
								target="_blank"
								className="rounded-sm underline decoration-veud-mint/70 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-veud-mint"
							>
								{provider.name}
							</a>
						</h2>
						<p className="leading-7 text-veud-copy">{provider.description}</p>
					</VeudPanel>
				))}
			</section>

			<VeudPanel tone="warm" className="space-y-3 p-6">
				<h2 className="text-2xl font-black text-veud-cream">Data boundaries</h2>
				<p className="leading-7 text-veud-copy">
					Scores, notes, list positions, diary entries, reviews, collections,
					and privacy settings created by Veud members belong to Veud&apos;s
					user data, not to a catalog provider. Provider names and marks belong
					to their respective owners; their appearance here does not imply
					endorsement of Veud.
				</p>
			</VeudPanel>
		</VeudPage>
	)
}
