import { useEffect, useRef } from 'react'
import { useFetcher, useLocation } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import {
	type ModerationTargetType,
	moderationReasonLabels,
	reportableModerationReasons,
} from '#app/utils/moderation.ts'

export function ReportContentButton({
	targetType,
	targetId,
	label,
}: {
	targetType: ModerationTargetType
	targetId: string
	label: string
}) {
	const fetcher = useFetcher<{
		ok: boolean
		error?: string
		duplicate?: boolean
	}>()
	const detailsRef = useRef<HTMLDetailsElement>(null)
	const location = useLocation()
	const succeeded = fetcher.data?.ok === true

	useEffect(() => {
		if (succeeded && detailsRef.current) detailsRef.current.open = false
	}, [succeeded])

	return (
		<div className="inline-flex flex-col items-end gap-1">
			<details ref={detailsRef} className="group relative">
				<summary className="cursor-pointer list-none rounded-md px-2 py-1 text-xs font-bold text-veud-mint transition hover:bg-black/20 hover:text-veud-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-veud-mint">
					Report
					<span className="sr-only"> {label}</span>
				</summary>
				<div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-veud-border bg-veud-surface-raised p-4 text-left shadow-2xl shadow-black/40">
					<fetcher.Form
						method="post"
						action="/resources/report-content"
						className="space-y-3"
					>
						<input type="hidden" name="targetType" value={targetType} />
						<input type="hidden" name="targetId" value={targetId} />
						<input
							type="hidden"
							name="returnTo"
							value={`${location.pathname}${location.search}`}
						/>
						<div>
							<p className="font-black text-veud-yellow">Report {label}</p>
							<p className="mt-1 text-xs leading-5 text-veud-copy">
								Reports are private and reviewed by Veud moderators.
							</p>
						</div>
						<label className="grid gap-1 text-xs font-bold text-veud-mint">
							Reason
							<select
								name="reasonCategory"
								required
								defaultValue=""
								className="h-10 rounded-md border border-veud-border bg-veud-canvas px-3 text-sm text-veud-cream"
							>
								<option value="" disabled>
									Choose a reason
								</option>
								{reportableModerationReasons.map(reason => (
									<option key={reason} value={reason}>
										{moderationReasonLabels[reason]}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1 text-xs font-bold text-veud-mint">
							Context (optional)
							<textarea
								name="details"
								maxLength={1000}
								rows={3}
								className="resize-y rounded-md border border-veud-border bg-veud-canvas px-3 py-2 text-sm text-veud-cream"
								placeholder="What should the moderation team know?"
							/>
						</label>
						<div className="flex justify-end">
							<Button
								type="submit"
								size="sm"
								disabled={fetcher.state !== 'idle'}
							>
								{fetcher.state === 'idle' ? 'Send report' : 'Sending…'}
							</Button>
						</div>
						{fetcher.data && !fetcher.data.ok ? (
							<p role="alert" className="text-xs font-bold text-destructive">
								{fetcher.data.error}
							</p>
						) : null}
					</fetcher.Form>
				</div>
			</details>
			{succeeded ? (
				<p role="status" className="text-xs text-veud-mint">
					{fetcher.data?.duplicate
						? 'Already in the moderation queue.'
						: 'Report sent privately.'}
				</p>
			) : null}
		</div>
	)
}
