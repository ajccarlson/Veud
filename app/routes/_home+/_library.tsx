import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { type HomeLibrarySummary } from '#app/utils/home-library.server.ts'

function formatScore(score: number | null) {
	return score === null ? '—' : score.toFixed(1)
}

export function HomeLibrary({
	username,
	summary,
	destinationCount,
}: {
	username: string
	summary: HomeLibrarySummary
	destinationCount: number
}) {
	const largestGroup = Math.max(1, ...summary.groups.map(group => group.count))

	return (
		<section
			className="home-library space-y-4 rounded-2xl border border-[#54806c] bg-[#383040] p-4 text-[#ffefcc] shadow-lg shadow-black/20"
			aria-labelledby="home-library-heading"
		>
			<header className="flex items-start justify-between gap-3">
				<div>
					<p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-[#a2ffd5]">
						At a glance
					</p>
					<h2
						id="home-library-heading"
						className="text-xl font-black text-[#ff9900]"
					>
						Your library
					</h2>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link to={`/lists/${username}`}>Open lists</Link>
				</Button>
			</header>

			<div className="grid grid-cols-3 gap-2" aria-label="Library totals">
				<div className="home-library-stat">
					<strong>{summary.totalTitles.toLocaleString()}</strong>
					<span>Titles</span>
				</div>
				<div className="home-library-stat">
					<strong>{formatScore(summary.meanScore)}</strong>
					<span>Mean score</span>
				</div>
				<div className="home-library-stat">
					<strong>{summary.repeatCount.toLocaleString()}</strong>
					<span>Repeats</span>
				</div>
			</div>

			<div className="space-y-2" aria-label="Titles by media type">
				{summary.groups.map(group => (
					<Link
						key={group.key}
						to={`/lists/${username}/${group.key}`}
						className="home-library-group group"
					>
						<span className="flex items-baseline justify-between gap-3 text-xs font-bold">
							<span className="text-[#c6ded2] group-hover:text-[#ffffb1]">
								{group.label}
							</span>
							<span className="text-[#ffffb1]">
								{group.count.toLocaleString()}
							</span>
						</span>
						<span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#222]">
							<span
								className={`home-library-bar home-library-bar--${group.key}`}
								style={{ width: `${(group.count / largestGroup) * 100}%` }}
							/>
						</span>
					</Link>
				))}
			</div>

			<footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#54806c]/60 pt-3 text-xs text-[#a2ffd5]">
				<span>
					{destinationCount} {destinationCount === 1 ? 'list' : 'lists'} ready
				</span>
				<div className="flex gap-3 font-bold">
					<Link to={`/users/${username}/activity`} className="hover:underline">
						Activity
					</Link>
					<Link to={`/users/${username}/stats`} className="hover:underline">
						Full stats
					</Link>
				</div>
			</footer>
		</section>
	)
}
