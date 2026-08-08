import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'

export type ReviewDetailComment = {
	id: string
	body: string
	parentId: string | null
	createdAt: string | Date
	isRemoved: boolean
	author: { id: string; username: string }
}

type ReviewDetail = {
	body: string
	comments: ReviewDetailComment[]
}

/**
 * The rest of one review.
 *
 * The media page sends an excerpt and a few comments so that listing twenty
 * reviews does not mean sending a hundred kilobytes of text and a thousand
 * comments. Anyone who wants the whole of one review asks for that one review.
 *
 * Both controls below call this. Clicking both costs two requests, which the
 * endpoint's short cache usually absorbs, and that is cheaper than the state
 * lifting needed to share one — the body and the discussion sit at opposite
 * ends of a review.
 */
async function fetchReviewDetail(reviewId: string): Promise<ReviewDetail> {
	const response = await fetch(
		`/resources/review-detail?reviewId=${encodeURIComponent(reviewId)}`,
		{
			headers: { accept: 'application/json' },
			// The response is cacheable for half a minute, which is right for a
			// shared cache and wrong here: this is only ever fetched because someone
			// clicked, and after posting a comment the browser would otherwise
			// replay a copy taken before it existed.
			cache: 'no-cache',
		},
	)
	if (!response.ok) throw new Error(String(response.status))
	const payload = (await response.json()) as { review?: Partial<ReviewDetail> }
	return {
		body: payload.review?.body ?? '',
		comments: payload.review?.comments ?? [],
	}
}

function FailureNote() {
	return (
		<p role="alert" className="mt-1 text-sm text-destructive">
			Could not load the rest of this review.
		</p>
	)
}

/**
 * A review's text, with the control that fetches the rest of it.
 *
 * The paragraph lives here rather than beside this component so that the full
 * body can *replace* the excerpt. Rendering it below instead would repeat the
 * first six hundred characters the reader had just finished.
 */
export function ReviewBody({
	reviewId,
	excerpt,
	truncated,
}: {
	reviewId: string
	excerpt: string
	truncated: boolean
}) {
	const [full, setFull] = useState<string | null>(null)
	const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')

	return (
		<>
			<p className="whitespace-pre-wrap leading-7 text-muted-foreground">
				{full ?? excerpt}
			</p>
			{truncated && full === null ? (
				<div className="mt-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={state === 'loading'}
						onClick={async () => {
							setState('loading')
							try {
								const detail = await fetchReviewDetail(reviewId)
								setFull(detail.body)
								setState('idle')
							} catch {
								// Say so rather than leaving a button that appears to do nothing.
								setState('failed')
							}
						}}
					>
						{state === 'loading' ? 'Loading…' : 'Read full review'}
					</Button>
					{state === 'failed' ? <FailureNote /> : null}
				</div>
			) : null}
		</>
	)
}

/**
 * The control that fetches the comments the page held back.
 *
 * It hands them to the discussion rather than listing them itself, so a reply
 * arriving late still nests under the comment it answers instead of appearing
 * as a flat list somewhere else on the page.
 */
export function MoreCommentsButton({
	reviewId,
	hidden,
	onLoaded,
}: {
	reviewId: string
	hidden: number
	onLoaded: (comments: ReviewDetailComment[]) => void
}) {
	const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
	if (hidden < 1) return null

	return (
		<div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={state === 'loading'}
				onClick={async () => {
					setState('loading')
					try {
						const detail = await fetchReviewDetail(reviewId)
						onLoaded(detail.comments)
					} catch {
						setState('failed')
					}
				}}
			>
				{state === 'loading'
					? 'Loading…'
					: `Show ${hidden} more ${hidden === 1 ? 'comment' : 'comments'}`}
			</Button>
			{state === 'failed' ? <FailureNote /> : null}
		</div>
	)
}
