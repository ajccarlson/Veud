import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { type FollowingActivityFeedItem } from '#app/utils/activity-feed.server.ts'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { getUserImgSrc } from '#app/utils/misc.tsx'

const PAGE_SIZE = 15

type SuggestedMember = {
	id: string
	username: string
	name: string | null
	image: { id: string } | null
}

function relativeTime(value: Date | string) {
	const difference = new Date(value).getTime() - Date.now()
	const absolute = Math.abs(difference)
	const units = [
		{ unit: 'year', milliseconds: 365 * 24 * 60 * 60 * 1_000 },
		{ unit: 'month', milliseconds: 30 * 24 * 60 * 60 * 1_000 },
		{ unit: 'day', milliseconds: 24 * 60 * 60 * 1_000 },
		{ unit: 'hour', milliseconds: 60 * 60 * 1_000 },
		{ unit: 'minute', milliseconds: 60 * 1_000 },
	] as const
	const selected =
		units.find(candidate => absolute >= candidate.milliseconds) ?? units.at(-1)!
	const amount = Math.round(difference / selected.milliseconds)
	return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
		amount,
		selected.unit,
	)
}

function displayDiaryDate(value: Date | string) {
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	})
}

function Suggestions({ members }: { members: SuggestedMember[] }) {
	if (!members.length) return null
	return (
		<div className="space-y-3">
			<h2 className="text-lg font-bold text-[#ffffb1]">Members to discover</h2>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{members.map(member => (
					<Link
						key={member.id}
						to={`/users/${member.username}`}
						className="flex items-center gap-3 rounded-xl border border-[#54806c] bg-[#383040] p-3 transition-colors hover:bg-[#44394c]"
					>
						<img
							src={getUserImgSrc(member.image?.id)}
							alt=""
							className="h-11 w-11 rounded-full border-2 border-[#54806c] object-cover"
						/>
						<div className="min-w-0">
							<div className="truncate font-semibold text-[#ffefcc]">
								{member.name ?? member.username}
							</div>
							<div className="truncate text-xs text-[#a2ffd5]">
								@{member.username}
							</div>
						</div>
					</Link>
				))}
			</div>
		</div>
	)
}

export function FollowingFeed({
	items,
	followingCount,
	suggestedMembers,
}: {
	items: FollowingActivityFeedItem[]
	followingCount: number
	suggestedMembers: SuggestedMember[]
}) {
	const [filterIndex, setFilterIndex] = useState(0)
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
	const filters = [
		{ key: 'all', label: 'All' },
		{ key: 'tracking', label: 'Tracking' },
		{ key: 'review', label: 'Reviews' },
		{ key: 'diary', label: 'Diary' },
		{ key: 'collection', label: 'Collections' },
	]
	const selectedFilter = filters[filterIndex]?.key ?? 'all'
	const filtered = items.filter(
		item => selectedFilter === 'all' || item.kind === selectedFilter,
	)

	useEffect(() => setVisibleCount(PAGE_SIZE), [filterIndex])

	return (
		<section className="w-full max-w-4xl space-y-4 self-center px-4 pt-4 text-[#ffefcc]">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-black text-[#ff9900]">Following</h1>
					<p className="text-sm text-[#a2ffd5]">
						Recent updates from the members you follow.
					</p>
				</div>
				<span className="text-sm text-[#a2ffd5]">
					{followingCount} following
				</span>
			</header>

			{items.length ? (
				<>
					<TypeSwitcher
						variant="primary"
						options={filters}
						index={filterIndex}
						onIndexChange={setFilterIndex}
					/>
					{filtered.length ? (
						<div className="space-y-3">
							{filtered.slice(0, visibleCount).map(item => {
								const poster = item.media
									? splitLegacyThumbnail(item.media.thumbnail).imageUrl
									: null
								return (
									<article
										key={item.id}
										className="rounded-xl border border-[#54806c] bg-[#383040] p-4"
									>
										<header className="flex items-start gap-3">
											<Link to={`/users/${item.actor.username}`}>
												<img
													src={getUserImgSrc(item.actor.image?.id)}
													alt=""
													className="h-11 w-11 rounded-full border-2 border-[#54806c] object-cover"
												/>
											</Link>
											<div className="min-w-0 flex-1">
												<div className="leading-6">
													<Link
														to={`/users/${item.actor.username}`}
														className="font-bold text-[#ffffb1] hover:underline"
													>
														{item.actor.name ?? item.actor.username}
													</Link>{' '}
													<span className="text-[#a2ffd5]">
														{item.action.toLowerCase()}
													</span>{' '}
													{item.collection ? (
														<Link
															to={`/collections/${item.collection.id}`}
															className="font-semibold text-[#ffefcc] hover:underline"
														>
															{item.collection.title}
														</Link>
													) : item.media ? (
														<Link
															to={`/media/${item.media.id}`}
															className="font-semibold text-[#ffefcc] hover:underline"
														>
															{item.media.title}
														</Link>
													) : null}
												</div>
												<time className="text-xs text-[#8ca99d]">
													{relativeTime(item.time)}
												</time>
											</div>
										</header>

										{(item.review || item.diary) && item.media ? (
											<div className="mt-3 flex gap-3 pl-14">
												{poster ? (
													<Link
														to={`/media/${item.media.id}`}
														className="hidden h-24 w-16 shrink-0 overflow-hidden rounded-md sm:block"
													>
														<img
															src={poster}
															alt=""
															className="h-full w-full object-cover"
														/>
													</Link>
												) : null}
												<div className="min-w-0 flex-1 text-sm">
													{item.review?.containsSpoilers ? (
														<details className="rounded-lg bg-[#2e2f2b] p-3">
															<summary className="cursor-pointer font-semibold text-[#ffffb1]">
																Spoiler review — reveal
															</summary>
															<p className="mt-2 whitespace-pre-wrap leading-6">
																{item.review.body}
															</p>
														</details>
													) : item.review ? (
														<p className="whitespace-pre-wrap leading-6">
															{item.review.body}
														</p>
													) : null}
													{item.review && item.review.rating !== null ? (
														<div className="mt-2 font-semibold text-[#a2ffd5]">
															{item.review.rating}/10
														</div>
													) : null}
													{item.diary ? (
														<div className="rounded-lg bg-[#2e2f2b] p-3 text-[#a2ffd5]">
															{displayDiaryDate(item.diary.loggedOn)}
															{item.diary.rating !== null
																? ` · ${item.diary.rating}/10`
																: ''}
														</div>
													) : null}
												</div>
											</div>
										) : null}

										{item.collection ? (
											<div className="mt-3 space-y-3 pl-14">
												{item.collection.description ? (
													<p className="line-clamp-3 text-sm leading-6 text-[#c6ded2]">
														{item.collection.description}
													</p>
												) : null}
												<div className="flex items-center gap-3">
													<div className="flex overflow-hidden rounded-md bg-[#2e2f2b]">
														{item.collection.items.map(collectionItem => {
															const image = splitLegacyThumbnail(
																collectionItem.media.thumbnail,
															).imageUrl
															return image ? (
																<img
																	key={collectionItem.media.id}
																	src={image}
																	alt=""
																	className="h-16 w-11 object-cover"
																/>
															) : null
														})}
													</div>
													<span className="text-sm font-semibold text-[#a2ffd5]">
														{item.collection.itemCount}{' '}
														{item.collection.itemCount === 1
															? 'title'
															: 'titles'}
													</span>
												</div>
											</div>
										) : null}
									</article>
								)
							})}
							{visibleCount < filtered.length ? (
								<div className="flex justify-center pt-2">
									<Button
										type="button"
										variant="outline"
										onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
									>
										Load more
									</Button>
								</div>
							) : null}
						</div>
					) : (
						<div className="rounded-xl bg-[#383040] p-6 text-center text-[#a2ffd5]">
							No updates in this category yet.
						</div>
					)}
				</>
			) : (
				<div className="space-y-5 rounded-xl bg-[#383040] p-6 text-center">
					<p className="text-[#a2ffd5]">
						{followingCount
							? 'The members you follow have not posted any activity yet.'
							: 'Follow members to build a personalized activity feed.'}
					</p>
					<Button asChild variant="outline">
						<Link to="/discover">Discover something to track</Link>
					</Button>
					<Suggestions members={suggestedMembers} />
				</div>
			)}
		</section>
	)
}
