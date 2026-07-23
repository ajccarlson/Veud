import { useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { type action } from '#app/routes/resources+/recommendation-feedback.ts'
import { type RecommendationLaneKey } from '#app/utils/recommendation-graph.ts'

export function RecommendationFeedbackControl({
	mediaId,
	title,
	lane,
}: {
	mediaId: string
	title: string
	lane: RecommendationLaneKey
}) {
	const fetcher = useFetcher<typeof action>()
	const busy = fetcher.state !== 'idle'

	return (
		<div className="grid grid-cols-2 gap-2">
			<fetcher.Form method="post" action="/resources/recommendation-feedback">
				<input type="hidden" name="intent" value="hide" />
				<input type="hidden" name="mediaId" value={mediaId} />
				<input type="hidden" name="feedbackType" value="not_interested" />
				<input type="hidden" name="sourceLane" value={lane} />
				<Button
					type="submit"
					size="sm"
					variant="ghost"
					disabled={busy}
					className="w-full text-xs"
					aria-label={`Hide ${title}`}
				>
					Not interested
				</Button>
			</fetcher.Form>
			<fetcher.Form method="post" action="/resources/recommendation-feedback">
				<input type="hidden" name="intent" value="hide" />
				<input type="hidden" name="mediaId" value={mediaId} />
				<input type="hidden" name="feedbackType" value="show_less" />
				<input type="hidden" name="sourceLane" value={lane} />
				<Button
					type="submit"
					size="sm"
					variant="ghost"
					disabled={busy}
					className="w-full text-xs"
					aria-label={`Show fewer titles like ${title}`}
				>
					Less like this
				</Button>
			</fetcher.Form>
		</div>
	)
}

export function RestoreRecommendationControl({
	mediaId,
	title,
}: {
	mediaId: string
	title: string
}) {
	const fetcher = useFetcher<typeof action>()
	return (
		<fetcher.Form method="post" action="/resources/recommendation-feedback">
			<input type="hidden" name="intent" value="restore" />
			<input type="hidden" name="mediaId" value={mediaId} />
			<Button
				type="submit"
				size="sm"
				variant="ghost"
				disabled={fetcher.state !== 'idle'}
				aria-label={`Restore ${title} to recommendations`}
			>
				Restore
			</Button>
		</fetcher.Form>
	)
}
