import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TypeSwitcher } from '#app/components/type-switcher.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { splitLegacyThumbnail } from '#app/utils/media-detail.ts'
import { journalTerms } from '#app/utils/media-journal.ts'
import {
	type ProfileDiaryData,
	type ProfileDiaryItem,
	type ProfileReviewsData,
	type ProfileReviewItem,
	type ProfileShellData,
} from '#app/utils/profile.ts'

const PAGE_SIZE = 15

function displayDate(value: Date | string, utc = false) {
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		...(utc ? { timeZone: 'UTC' } : {}),
	})
}

function MediaThumbnail({
	media,
}: {
	media: ProfileReviewItem['media'] | ProfileDiaryItem['media']
}) {
	const imageUrl = splitLegacyThumbnail(media.thumbnail).imageUrl
	return (
		<Link
			to={`/media/${media.id}`}
			className="block aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--veud-surface-alt)]"
			aria-label={media.title}
		>
			{imageUrl ? (
				<img src={imageUrl} alt="" className="h-full w-full object-cover" />
			) : null}
		</Link>
	)
}

function ProfileFilter({
	data,
	filterIndex,
	onChange,
}: {
	data: Pick<ProfileShellData, 'listTypes'>
	filterIndex: number
	onChange: (index: number) => void
}) {
	return (
		<TypeSwitcher
			variant="primary"
			options={[
				{ key: 'all', label: 'All' },
				...data.listTypes.map(type => ({ key: type.id, label: type.header })),
			]}
			index={filterIndex}
			onIndexChange={onChange}
		/>
	)
}

function LoadMore({ onClick }: { onClick: () => void }) {
	return (
		<div className="flex justify-center pt-2">
			<Button type="button" variant="outline" onClick={onClick}>
				Load more
			</Button>
		</div>
	)
}

export function ProfileReviewsData({ data }: { data: ProfileReviewsData }) {
	const [filterIndex, setFilterIndex] = useState(0)
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
	const selectedTypeId =
		filterIndex === 0 ? 'all' : data.listTypes[filterIndex - 1]?.id
	const reviews = data.reviews.filter(
		review => selectedTypeId === 'all' || review.typeId === selectedTypeId,
	)

	useEffect(() => setVisibleCount(PAGE_SIZE), [filterIndex])

	return (
		<section className="mx-auto max-w-5xl space-y-4 text-[var(--veud-cream)]">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-bold text-[var(--veud-highlight)]">
						Reviews
					</h1>
					<p className="text-sm text-[var(--veud-mint-text)]">
						Long-form thoughts published by{' '}
						{data.user.name ?? data.user.username}.
					</p>
				</div>
				<span className="text-sm text-[var(--veud-mint-text)]">
					{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
				</span>
			</header>

			<ProfileFilter
				data={data}
				filterIndex={filterIndex}
				onChange={setFilterIndex}
			/>

			{reviews.length ? (
				<div className="space-y-3">
					{reviews.slice(0, visibleCount).map(review => {
						const edited =
							new Date(review.updatedAt).getTime() -
								new Date(review.createdAt).getTime() >
							1_000
						return (
							<article
								key={review.id}
								className="flex gap-4 rounded-xl border border-[var(--veud-control)] bg-[var(--veud-surface)] p-4"
							>
								<MediaThumbnail media={review.media} />
								<div className="min-w-0 flex-1 space-y-3">
									<header className="flex flex-wrap items-start justify-between gap-2">
										<div>
											<Link
												to={`/media/${review.media.id}`}
												className="font-bold text-[var(--veud-highlight)] hover:underline"
											>
												{review.media.title}
											</Link>
											{review.rating !== null ? (
												<span className="ml-2 text-sm font-semibold text-[var(--veud-mint)]">
													{review.rating}/10
												</span>
											) : null}
										</div>
										<span className="text-xs text-[var(--veud-mint-text)]">
											{displayDate(review.createdAt)}
											{edited ? ' · Edited' : ''}
										</span>
									</header>
									{review.containsSpoilers ? (
										<details className="rounded-lg border border-[var(--veud-control)] bg-[var(--veud-surface-alt)] p-3">
											<summary className="cursor-pointer font-semibold text-[var(--veud-highlight)]">
												Contains spoilers — reveal review
											</summary>
											<p className="mt-3 whitespace-pre-wrap leading-7">
												{review.body}
											</p>
										</details>
									) : (
										<p className="whitespace-pre-wrap leading-7">
											{review.body}
										</p>
									)}
								</div>
							</article>
						)
					})}
					{visibleCount < reviews.length ? (
						<LoadMore
							onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
						/>
					) : null}
				</div>
			) : (
				<div className="rounded-xl bg-[var(--veud-surface)] p-6 text-center text-[var(--veud-mint-text)]">
					No reviews for this media type yet.
				</div>
			)}
		</section>
	)
}

export function ProfileDiaryData({ data }: { data: ProfileDiaryData }) {
	const [filterIndex, setFilterIndex] = useState(0)
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
	const selectedTypeId =
		filterIndex === 0 ? 'all' : data.listTypes[filterIndex - 1]?.id
	const diaryEntries = data.diaryEntries
		.filter(
			entry => selectedTypeId === 'all' || entry.typeId === selectedTypeId,
		)
		.slice()
		.sort(
			(a, b) =>
				new Date(b.loggedOn).getTime() - new Date(a.loggedOn).getTime() ||
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
				b.id.localeCompare(a.id),
		)

	useEffect(() => setVisibleCount(PAGE_SIZE), [filterIndex])

	return (
		<section className="mx-auto max-w-5xl space-y-4 text-[var(--veud-cream)]">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-bold text-[var(--veud-highlight)]">
						Diary
					</h1>
					<p className="text-sm text-[var(--veud-mint-text)]">
						Dated watches and reads from {data.user.name ?? data.user.username}.
					</p>
				</div>
				<span className="text-sm text-[var(--veud-mint-text)]">
					{diaryEntries.length}{' '}
					{diaryEntries.length === 1 ? 'entry' : 'entries'}
				</span>
			</header>

			<ProfileFilter
				data={data}
				filterIndex={filterIndex}
				onChange={setFilterIndex}
			/>

			{diaryEntries.length ? (
				<div className="overflow-hidden rounded-xl border border-[var(--veud-control)] bg-[var(--veud-surface)]">
					<ul className="divide-y divide-[var(--veud-control)]">
						{diaryEntries.slice(0, visibleCount).map(entry => {
							const terms = journalTerms(entry.media.kind)
							return (
								<li key={entry.id} className="flex items-center gap-4 p-4">
									<MediaThumbnail media={entry.media} />
									<div className="min-w-0 flex-1">
										<Link
											to={`/media/${entry.media.id}`}
											className="font-bold text-[var(--veud-highlight)] hover:underline"
										>
											{entry.media.title}
										</Link>
										<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--veud-mint-text)]">
											<time>{displayDate(entry.loggedOn, true)}</time>
											<span>{entry.isRepeat ? terms.repeat : terms.past}</span>
											{entry.rating !== null ? (
												<span className="font-semibold text-[var(--veud-mint)]">
													{entry.rating}/10
												</span>
											) : null}
										</div>
									</div>
								</li>
							)
						})}
					</ul>
					{visibleCount < diaryEntries.length ? (
						<div className="p-4">
							<LoadMore
								onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
							/>
						</div>
					) : null}
				</div>
			) : (
				<div className="rounded-xl bg-[var(--veud-surface)] p-6 text-center text-[var(--veud-mint-text)]">
					No diary entries for this media type yet.
				</div>
			)}
		</section>
	)
}
