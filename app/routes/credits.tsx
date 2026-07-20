import { type MetaFunction } from 'react-router'

const tmdbLogo =
	'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_long_2-9665a76b1ae401a510ec1e0ca40ddcb3b0cfe45f1d51b77a308fea0845885648.svg'

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
		<main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 text-[#ffefcc] sm:px-6 lg:px-8">
			<header className="max-w-3xl space-y-3">
				<p className="text-sm font-bold uppercase tracking-[0.2em] text-[#a2ffd5]">
					About Veud
				</p>
				<h1 className="text-4xl font-black text-[#ff9900]">
					Data sources &amp; credits
				</h1>
				<p className="text-base leading-7 text-[#c6ded2]">
					Veud combines user-owned tracking and reviews with metadata supplied
					by independent media-data providers. Provider data keeps its source
					identity so it can be refreshed, corrected, or removed without
					deleting member history.
				</p>
			</header>

			<section className="space-y-4 rounded-2xl border border-[#54806c] bg-[#383040] p-6 shadow-xl shadow-black/10">
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
						referrerPolicy="no-referrer"
						src={tmdbLogo}
					/>
				</a>
				<h2 className="text-2xl font-black text-[#ffefcc]">
					The Movie Database
				</h2>
				<p className="leading-7 text-[#c6ded2]">
					Movie and television identities, artwork, scores, release information,
					and catalog metadata are supplied by TMDB.
				</p>
				<p className="rounded-xl border border-[#01b4e4]/60 bg-[#0d253f] p-4 font-semibold leading-7 text-white">
					This product uses the TMDB API but is not endorsed or certified by
					TMDB.
				</p>
			</section>

			<section
				className="grid gap-4 md:grid-cols-3"
				aria-label="Other providers"
			>
				{providers.map(provider => (
					<article
						key={provider.name}
						className="space-y-3 rounded-2xl border border-[#54806c] bg-[#383040] p-5"
					>
						<h2 className="text-xl font-black text-[#ff9900]">
							<a
								href={provider.href}
								rel="noreferrer"
								target="_blank"
								className="rounded-sm underline decoration-[#a2ffd5]/70 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a2ffd5]"
							>
								{provider.name}
							</a>
						</h2>
						<p className="leading-7 text-[#c6ded2]">{provider.description}</p>
					</article>
				))}
			</section>

			<section className="space-y-3 rounded-2xl border border-[#725b78] bg-[#302937] p-6">
				<h2 className="text-2xl font-black text-[#ffefcc]">Data boundaries</h2>
				<p className="leading-7 text-[#c6ded2]">
					Scores, notes, list positions, diary entries, reviews, collections,
					and privacy settings created by Veud members belong to Veud&apos;s
					user data, not to a catalog provider. Provider names and marks belong
					to their respective owners; their appearance here does not imply
					endorsement of Veud.
				</p>
			</section>
		</main>
	)
}
