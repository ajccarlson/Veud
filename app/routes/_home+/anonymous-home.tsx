import { Link, useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon, type IconName } from '#app/components/ui/icon.tsx'
import { type action as homeMemorySearchAction } from '#app/routes/resources+/home-memory-search.ts'
import {
	type AnonymousHomeActivity,
	type AnonymousHomeProof,
} from '#app/utils/anonymous-home.server.ts'
import {
	type HomeTrendingItem,
	type HomeTrendingRail,
} from '#app/utils/home-trending.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { TrendingData } from './_trending.tsx'

const kindLabels: Record<string, string> = {
	movie: 'Movies',
	tv: 'Television',
	anime: 'Anime',
	manga: 'Manga',
}

const capabilityCards: Array<{
	icon: IconName
	title: string
	copy: string
	accent: string
}> = [
	{
		icon: 'archive',
		title: 'One connected library',
		copy: 'Film, TV, anime, and manga stay together without losing their detail.',
		accent: 'amber',
	},
	{
		icon: 'table',
		title: 'Track it your way',
		copy: 'Progress, scores, dates, notes, and detailed lists on every screen.',
		accent: 'mint',
	},
	{
		icon: 'magic-wand',
		title: 'Find the half-remembered',
		copy: 'Turn fragments, scenes, or an image into grounded catalog matches.',
		accent: 'violet',
	},
	{
		icon: 'group',
		title: 'Follow good taste',
		copy: 'Discover public lists, reviews, and activity from other members.',
		accent: 'gold',
	},
]

const providerNames = ['MyAnimeList', 'AniList', 'Trakt', 'Letterboxd']

function posterFor(thumbnail: string | null) {
	return splitLegacyThumbnail(thumbnail).imageUrl
}

function uniquePreviewItems(rails: HomeTrendingRail[]) {
	const seen = new Set<string>()
	return rails
		.flatMap(rail => rail.items.slice(0, 2))
		.filter(item => {
			if (seen.has(item.id)) return false
			seen.add(item.id)
			return true
		})
		.slice(0, 4)
}

function displayDate(value: Date | string) {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(value))
}

function resultDetails(item: {
	type: string | null
	kind: string
	year: string | null
}) {
	return [item.type || kindLabels[item.kind] || item.kind, item.year]
		.filter(Boolean)
		.join(' · ')
}

function MemoryDemo() {
	const fetcher = useFetcher<typeof homeMemorySearchAction>()
	const pending = fetcher.state !== 'idle'
	const items = fetcher.data?.ok ? fetcher.data.items : []

	return (
		<section
			className="home-anon-memory"
			aria-labelledby="home-anon-memory-title"
		>
			<div className="home-anon-memory-heading">
				<span>
					<Icon name="magic-wand" aria-hidden="true" />
					Live catalog demo
				</span>
				<h2 id="home-anon-memory-title">What was that title?</h2>
				<p>Describe whatever you remember.</p>
			</div>
			<fetcher.Form
				method="post"
				action="/resources/home-memory-search"
				className="home-anon-memory-form"
			>
				<label htmlFor="home-memory-query" className="sr-only">
					Describe the movie, show, anime, or manga you remember
				</label>
				<textarea
					id="home-memory-query"
					name="q"
					minLength={3}
					maxLength={500}
					required
					rows={3}
					placeholder="A mystery about an isolated lighthouse, a strange journal, and repeating days…"
				/>
				<div className="home-anon-memory-controls">
					<label>
						<span className="sr-only">Memory search media type</span>
						<select
							name="kind"
							defaultValue="all"
							aria-label="Memory search media type"
						>
							<option value="all">All media</option>
							<option value="movie">Movies</option>
							<option value="tv">TV</option>
							<option value="anime">Anime</option>
							<option value="manga">Manga</option>
						</select>
					</label>
					<Button type="submit" disabled={pending}>
						<Icon
							name={pending ? 'update' : 'magnifying-glass'}
							aria-hidden="true"
						/>
						{pending ? 'Searching…' : 'Find matches'}
					</Button>
				</div>
			</fetcher.Form>

			{pending ? (
				<div
					className="home-anon-memory-pending"
					role="status"
					aria-label="Tip of My Tongue search in progress"
				>
					<span aria-hidden="true">
						<Icon name="update" />
					</span>
					<strong>Searching Veud’s catalog</strong>
				</div>
			) : fetcher.data && !fetcher.data.ok ? (
				<p className="home-anon-memory-error" role="alert">
					{fetcher.data.error}
				</p>
			) : items.length ? (
				<div className="home-anon-memory-results" aria-live="polite">
					<div className="home-anon-memory-result-list">
						{items.map(item => {
							const poster = posterFor(item.thumbnail)
							return (
								<Link
									key={item.id}
									to={`/media/${item.id}`}
									className="home-anon-memory-result"
								>
									<div>
										{poster ? (
											<img src={poster} alt="" />
										) : (
											<Icon name="image" aria-hidden="true" />
										)}
									</div>
									<span>
										<strong>{item.title}</strong>
										<small>{resultDetails(item)}</small>
									</span>
								</Link>
							)
						})}
					</div>
					<p>
						Want AI and image clues? <Link to="/signup">Create an account</Link>
					</p>
				</div>
			) : null}
		</section>
	)
}

function ProductPreview({ rails }: { rails: HomeTrendingRail[] }) {
	const items = uniquePreviewItems(rails)

	return (
		<section
			className="home-anon-product"
			aria-labelledby="home-anon-product-title"
		>
			<header>
				<div>
					<p>A sample workspace</p>
					<h2 id="home-anon-product-title">Your library, at a glance</h2>
				</div>
				<span>
					<Icon name="desktop" aria-hidden="true" />
					Detailed view
				</span>
			</header>
			<div className="home-anon-product-frame">
				<div className="home-anon-product-sidebar" aria-hidden="true">
					<strong>My archive</strong>
					<span className="is-active">Watching</span>
					<span>Planning</span>
					<span>Completed</span>
					<span>Favorites</span>
				</div>
				<div className="home-anon-product-table">
					<div className="home-anon-product-columns" aria-hidden="true">
						<span>Title</span>
						<span>Format</span>
						<span>Progress</span>
						<span>Score</span>
						<span>Status</span>
					</div>
					{items.length ? (
						items.map(item => <PreviewRow key={item.id} item={item} />)
					) : (
						<div className="home-anon-product-empty">
							<Icon name="archive" aria-hidden="true" />
							<span>Your titles will line up here.</span>
						</div>
					)}
				</div>
			</div>
			<footer>
				<span>
					<Icon name="mixer-horizontal" aria-hidden="true" />
					Private lists
				</span>
				<span>
					<Icon name="mobile" aria-hidden="true" />
					Mobile cards
				</span>
				<span>
					<Icon name="download" aria-hidden="true" />
					Data export
				</span>
			</footer>
		</section>
	)
}

function sampleTrackingFor(item: HomeTrendingItem) {
	switch (item.kind) {
		case 'manga':
			return { progress: '38 ch.', status: 'Reading' }
		case 'tv':
		case 'anime':
			return { progress: '7 / 12', status: 'Watching' }
		default:
			return { progress: '—', status: 'Plan to watch' }
	}
}

function PreviewRow({ item }: { item: HomeTrendingItem }) {
	const poster = posterFor(item.thumbnail)
	const tracking = sampleTrackingFor(item)

	return (
		<Link to={`/media/${item.id}`} className="home-anon-product-row">
			<span className="home-anon-product-title">
				<span className="home-anon-product-poster">
					{poster ? (
						<img src={poster} alt="" />
					) : (
						<Icon name="image" aria-hidden="true" />
					)}
				</span>
				<strong>{item.title}</strong>
			</span>
			<span>{item.type || kindLabels[item.kind] || item.kind}</span>
			<span>{tracking.progress}</span>
			<span>{item.score === null ? '—' : item.score.toFixed(1)}</span>
			<span>{tracking.status}</span>
		</Link>
	)
}

function CommunityProof({ proof }: { proof: AnonymousHomeProof }) {
	const statistics = [
		{ value: proof.catalogTotal, label: 'catalog titles' },
		{ value: proof.reviewTotal, label: 'public reviews' },
		{ value: proof.publicCollectionTotal, label: 'public collections' },
	]

	return (
		<section
			className="home-anon-proof"
			aria-labelledby="home-anon-proof-title"
		>
			<div className="home-anon-proof-catalog">
				<p className="home-anon-eyebrow">Built on a living catalog</p>
				<h2 id="home-anon-proof-title">
					Plenty to explore. Room to make it yours.
				</h2>
				<div className="home-anon-statistics">
					{statistics.map(statistic => (
						<div key={statistic.label}>
							<strong>{statistic.value.toLocaleString()}</strong>
							<span>{statistic.label}</span>
						</div>
					))}
				</div>
				<div className="home-anon-kind-counts">
					{proof.kinds.map(item => (
						<span key={item.kind}>
							<strong>{item.count.toLocaleString()}</strong>{' '}
							{kindLabels[item.kind] || item.kind}
						</span>
					))}
				</div>
			</div>
			<div className="home-anon-community">
				<header>
					<div>
						<p className="home-anon-eyebrow">Community pulse</p>
						<h3>What members are sharing</h3>
					</div>
					<Link to="/users">Meet the community</Link>
				</header>
				{proof.activity.length ? (
					<ul>
						{proof.activity.map(item => (
							<CommunityActivity key={item.id} item={item} />
						))}
					</ul>
				) : (
					<div className="home-anon-community-empty">
						Public tracking updates, reviews, and collections appear here.
					</div>
				)}
			</div>
		</section>
	)
}

function CommunityActivity({ item }: { item: AnonymousHomeActivity }) {
	const poster = posterFor(item.target.thumbnail)
	const targetPath =
		item.target.type === 'collection'
			? `/collections/${item.target.id}`
			: `/media/${item.target.id}`

	return (
		<li>
			<span className="home-anon-community-poster">
				{poster ? (
					<img src={poster} alt="" />
				) : (
					<Icon
						name={item.target.type === 'collection' ? 'archive' : 'image'}
						aria-hidden="true"
					/>
				)}
			</span>
			<span>
				<span>
					<Link to={`/users/${item.username}`}>@{item.username}</Link>{' '}
					{item.action.toLowerCase()}
				</span>
				<Link to={targetPath}>{item.target.title}</Link>
			</span>
			<time dateTime={new Date(item.createdAt).toISOString()}>
				{displayDate(item.createdAt)}
			</time>
		</li>
	)
}

export function AnonymousHome({
	rails,
	proof,
}: {
	rails: HomeTrendingRail[]
	proof: AnonymousHomeProof
}) {
	return (
		<div className="home-anon">
			<section className="home-anon-hero" aria-labelledby="home-anon-title">
				<div className="home-anon-hero-copy">
					<p className="home-anon-eyebrow">One archive · every medium</p>
					<h1 id="home-anon-title">Remember it. Track it. Find what’s next.</h1>
					<p className="home-anon-lede">
						Build one thoughtful library for films, television, anime, and
						manga—with the detail each one deserves.
					</p>
					<div className="home-anon-actions">
						<Button asChild size="lg">
							<Link to="/signup">Create your library</Link>
						</Button>
						<Button asChild size="lg" variant="outline">
							<Link to="/discover">Explore the catalog</Link>
						</Button>
					</div>
					<Link to="/login" className="home-anon-signin">
						Already a member? Sign in
					</Link>
				</div>
				<MemoryDemo />
			</section>

			<div className="home-anon-trending">
				<TrendingData rails={rails} watchlists={[]} isSignedIn={false} />
			</div>

			<ProductPreview rails={rails} />

			<section className="home-anon-capabilities" aria-label="Why use Veud">
				{capabilityCards.map(card => (
					<article key={card.title} data-accent={card.accent}>
						<span>
							<Icon name={card.icon} aria-hidden="true" />
						</span>
						<h2>{card.title}</h2>
						<p>{card.copy}</p>
					</article>
				))}
			</section>

			<section className="home-anon-import" aria-label="Library import options">
				<div>
					<Icon name="upload" aria-hidden="true" />
					<span>
						<strong>Bring your history with you.</strong>
						Import an existing library after signup.
					</span>
				</div>
				<ul>
					{providerNames.map(provider => (
						<li key={provider}>{provider}</li>
					))}
				</ul>
			</section>

			<CommunityProof proof={proof} />

			<section
				className="home-anon-final"
				aria-labelledby="home-anon-final-title"
			>
				<span aria-hidden="true">
					<Icon name="archive" />
				</span>
				<div>
					<p className="home-anon-eyebrow">Start your archive</p>
					<h2 id="home-anon-final-title">
						Your next favorite deserves a place you can find again.
					</h2>
				</div>
				<div>
					<Button asChild size="lg">
						<Link to="/signup">Create your library</Link>
					</Button>
					<Button asChild size="lg" variant="ghost">
						<Link to="/login">Sign in</Link>
					</Button>
				</div>
			</section>
		</div>
	)
}
