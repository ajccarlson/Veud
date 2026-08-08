import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
	ProfileEmptyState,
	ProfilePageHeader,
	ProfileSegmentedFilter,
} from '#app/components/profile-ui.tsx'
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
			className="user-landing-journal-thumbnail"
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
	value,
	onChange,
	label,
}: {
	data: Pick<ProfileShellData, 'listTypes'>
	value: string
	onChange: (value: string) => void
	label: string
}) {
	return (
		<ProfileSegmentedFilter
			label={label}
			options={[
				{ key: 'all', label: 'All' },
				...data.listTypes.map(type => ({ key: type.id, label: type.header })),
			]}
			value={value}
			onValueChange={onChange}
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
	const [selectedTypeId, setSelectedTypeId] = useState('all')
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
	const reviews = data.reviews.filter(
		review => selectedTypeId === 'all' || review.typeId === selectedTypeId,
	)

	useEffect(() => setVisibleCount(PAGE_SIZE), [selectedTypeId])

	return (
		<section className="user-landing-journal">
			<ProfilePageHeader
				eyebrow="Journal"
				title="Reviews"
				description={<>Long-form thoughts published by {data.user.username}.</>}
				meta={`${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`}
				action={
					<ProfileFilter
						data={data}
						value={selectedTypeId}
						onChange={setSelectedTypeId}
						label="Filter reviews by media type"
					/>
				}
			/>

			{reviews.length ? (
				<div className="user-landing-journal-list">
					{reviews.slice(0, visibleCount).map(review => {
						const edited =
							new Date(review.updatedAt).getTime() -
								new Date(review.createdAt).getTime() >
							1_000
						return (
							<article key={review.id} className="user-landing-journal-card">
								<MediaThumbnail media={review.media} />
								<div className="user-landing-journal-card-body">
									<header className="flex flex-wrap items-start justify-between gap-2">
										<div>
											<Link
												to={`/media/${review.media.id}`}
												className="font-bold text-[rgb(var(--veud-highlight))] hover:underline"
											>
												{review.media.title}
											</Link>
											{review.rating !== null ? (
												<span className="ml-2 text-sm font-semibold text-[rgb(var(--veud-mint))]">
													{review.rating}/10
												</span>
											) : null}
										</div>
										<span className="text-xs text-[rgb(var(--veud-sage))]">
											{displayDate(review.createdAt)}
											{edited ? ' · Edited' : ''}
										</span>
									</header>
									{review.containsSpoilers ? (
										<details className="user-landing-spoiler">
											<summary className="cursor-pointer font-semibold text-[rgb(var(--veud-highlight))]">
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
				<ProfileEmptyState
					icon="reader"
					title="Nothing published here yet"
					description="Choose another media type, or check back after this member publishes a review."
				/>
			)}
		</section>
	)
}

export function ProfileDiaryData({ data }: { data: ProfileDiaryData }) {
	const [selectedTypeId, setSelectedTypeId] = useState('all')
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
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

	useEffect(() => setVisibleCount(PAGE_SIZE), [selectedTypeId])

	return (
		<section className="user-landing-journal">
			<ProfilePageHeader
				eyebrow="Journal"
				title="Diary"
				description={`Dated watches and reads from ${data.user.username}.`}
				meta={`${diaryEntries.length} ${diaryEntries.length === 1 ? 'entry' : 'entries'}`}
				action={
					<ProfileFilter
						data={data}
						value={selectedTypeId}
						onChange={setSelectedTypeId}
						label="Filter diary by media type"
					/>
				}
			/>

			{diaryEntries.length ? (
				<div className="user-landing-diary-panel">
					<ul className="user-landing-diary-list">
						{diaryEntries.slice(0, visibleCount).map(entry => {
							const terms = journalTerms(entry.media.kind)
							return (
								<li key={entry.id} className="user-landing-diary-row">
									<MediaThumbnail media={entry.media} />
									<div className="min-w-0 flex-1">
										<Link
											to={`/media/${entry.media.id}`}
											className="font-bold text-[rgb(var(--veud-highlight))] hover:underline"
										>
											{entry.media.title}
										</Link>
										<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[rgb(var(--veud-sage))]">
											<time>{displayDate(entry.loggedOn, true)}</time>
											<span>{entry.isRepeat ? terms.repeat : terms.past}</span>
											{entry.rating !== null ? (
												<span className="font-semibold text-[rgb(var(--veud-mint))]">
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
				<ProfileEmptyState
					icon="calendar"
					title="Nothing logged here yet"
					description="Choose another media type, or check back after this member logs a title."
				/>
			)}
		</section>
	)
}
