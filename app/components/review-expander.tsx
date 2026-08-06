import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'

type ReviewComment = {
	id: string
	body: string
	parentId: string | null
	createdAt: string | Date
	author: { id: string; username: string } | null
}

/**
 * The control that fetches the rest of a review.
 *
 * The media page sends an excerpt and a few comments so that listing twenty
 * reviews does not mean sending a hundred kilobytes of text and a thousand
 * comments. Anyone who wants the whole of one review asks for that one review.
 */
export function ReviewExpander({
	reviewId,
	truncated,
	hiddenComments,
}: {
	reviewId: string
	truncated: boolean
	hiddenComments: number
}) {
	const [body, setBody] = useState<string | null>(null)
	const [comments, setComments] = useState<ReviewComment[] | null>(null)
	const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')

	if (!truncated && hiddenComments < 1) return null
	if (body || comments) {
		return (
			<div className="mt-3 space-y-3">
				{body ? (
					<p className="whitespace-pre-wrap leading-7 text-muted-foreground">
						{body}
					</p>
				) : null}
				{comments?.length ? (
					<ul className="space-y-2 border-t pt-3">
						{comments.map(comment => (
							<li key={comment.id} className="text-sm">
								<span className="font-semibold">
									{comment.author?.username ?? 'Removed member'}
								</span>{' '}
								<span className="text-muted-foreground">{comment.body}</span>
							</li>
						))}
					</ul>
				) : null}
			</div>
		)
	}

	const label = truncated
		? hiddenComments > 0
			? `Read full review and ${hiddenComments} more comments`
			: 'Read full review'
		: `Show ${hiddenComments} more comments`

	return (
		<div className="mt-2">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={state === 'loading'}
				onClick={async () => {
					setState('loading')
					try {
						const response = await fetch(
							`/resources/review-detail?reviewId=${encodeURIComponent(reviewId)}`,
							{ headers: { accept: 'application/json' } },
						)
						if (!response.ok) throw new Error(String(response.status))
						const payload = (await response.json()) as {
							review?: { body?: string; comments?: ReviewComment[] }
						}
						setBody(truncated ? (payload.review?.body ?? '') : null)
						setComments(payload.review?.comments ?? [])
						setState('idle')
					} catch {
						// Say so rather than leaving a button that appears to do nothing.
						setState('failed')
					}
				}}
			>
				{state === 'loading' ? 'Loading…' : label}
			</Button>
			{state === 'failed' ? (
				<p role="alert" className="mt-1 text-sm text-destructive">
					Could not load the rest of this review.
				</p>
			) : null}
		</div>
	)
}
