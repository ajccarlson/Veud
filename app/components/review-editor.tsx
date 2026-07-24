import { useState } from 'react'
import { Form, useFetcher, useNavigation } from 'react-router'
import { type action as reviewAssistanceAction } from '#app/routes/resources+/review-assistance.ts'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'
import { Textarea } from './ui/textarea.tsx'

const operations = [
	['clarity', 'Clarity'],
	['grammar', 'Grammar'],
	['structure', 'Structure'],
	['concise', 'Make concise'],
	['tone', 'Tone check'],
	['spoilers', 'Spoiler check'],
] as const

export function ReviewEditor({
	initialBody,
	initialRating,
	initialContainsSpoilers,
	maxLength,
	isExisting,
}: {
	initialBody: string
	initialRating: number | null
	initialContainsSpoilers: boolean
	maxLength: number
	isExisting: boolean
}) {
	const [draft, setDraft] = useState(initialBody)
	const [assistantVisible, setAssistantVisible] = useState(true)
	const assistant = useFetcher<typeof reviewAssistanceAction>()
	const navigation = useNavigation()
	const publishing = navigation.state !== 'idle'
	const assisting = assistant.state !== 'idle'
	const assistance =
		assistantVisible && !assisting && assistant.data?.ok
			? assistant.data.assistance
			: null

	function requestAssistance(operation: (typeof operations)[number][0]) {
		setAssistantVisible(true)
		assistant.submit(
			{ draft, operation },
			{ method: 'post', action: '/resources/review-assistance' },
		)
	}

	return (
		<div className="space-y-4">
			<Form method="post" className="space-y-3">
				<input type="hidden" name="intent" value="review-save" />
				<div className="space-y-2">
					<Label htmlFor="review-body">Review</Label>
					<Textarea
						id="review-body"
						name="body"
						value={draft}
						onChange={event => setDraft(event.currentTarget.value)}
						maxLength={maxLength}
						rows={7}
						required
						placeholder="What did you think?"
					/>
				</div>
				<div className="flex flex-wrap items-end gap-3">
					<div className="w-32 space-y-2">
						<Label htmlFor="review-rating">Review rating</Label>
						<Input
							id="review-rating"
							name="rating"
							type="number"
							min="0.1"
							max="10"
							step="0.1"
							defaultValue={initialRating ?? ''}
							placeholder="Optional"
						/>
					</div>
					<label className="flex flex-1 items-center gap-2 pb-2 text-sm">
						<input
							type="checkbox"
							name="containsSpoilers"
							value="true"
							defaultChecked={initialContainsSpoilers}
						/>
						Contains spoilers
					</label>
					<Button type="submit" disabled={publishing}>
						{isExisting ? 'Update review' : 'Publish review'}
					</Button>
				</div>
			</Form>

			<section className="rounded-xl border border-veud-border/70 bg-black/10 p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h3 className="font-black text-veud-cream">Writing tools</h3>
						<p className="mt-1 text-xs leading-5 text-veud-copy">
							AI suggestions never save or publish automatically.
						</p>
					</div>
					{assisting ? (
						<span className="text-sm font-bold text-veud-mint" role="status">
							Reviewing your draft…
						</span>
					) : null}
				</div>
				<div className="mt-3 flex flex-wrap gap-2">
					{operations.map(([value, label]) => (
						<Button
							key={value}
							type="button"
							size="sm"
							variant="outline"
							disabled={assisting || draft.trim().length < 20}
							onClick={() => requestAssistance(value)}
						>
							{label}
						</Button>
					))}
				</div>
				{assistant.data && !assistant.data.ok ? (
					<p className="mt-3 text-sm text-red-200" role="alert">
						{assistant.data.error}
					</p>
				) : null}
				{assistance ? (
					<div className="mt-4 space-y-3">
						<div className="flex justify-end">
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => setAssistantVisible(false)}
							>
								Discard suggestions
							</Button>
						</div>
						<div
							className={`rounded-lg border p-3 text-sm ${
								assistance.spoilerLikelihood === 'high'
									? 'border-amber-300/50 bg-amber-950/25 text-amber-100'
									: 'border-veud-border bg-black/10 text-veud-copy'
							}`}
						>
							<strong>
								Spoiler likelihood: {assistance.spoilerLikelihood}
							</strong>
							{assistance.spoilerReason
								? ` — ${assistance.spoilerReason}`
								: null}
						</div>
						{assistance.findings.map((finding, index) => (
							<div
								key={`${finding.category}:${finding.original}:${index}`}
								className="rounded-lg border border-veud-border bg-black/10 p-3 text-sm"
							>
								<div className="flex flex-wrap justify-between gap-2">
									<strong className="capitalize text-veud-mint">
										{finding.category}
										{finding.substantive ? ' · substantive' : ' · mechanical'}
									</strong>
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={!draft.includes(finding.original)}
										onClick={() =>
											setDraft(current =>
												current.replace(finding.original, finding.replacement),
											)
										}
									>
										Apply this suggestion
									</Button>
								</div>
								<p className="mt-2 text-veud-copy">{finding.explanation}</p>
								<div className="mt-2 grid gap-2 sm:grid-cols-2">
									<del className="rounded bg-red-950/25 p-2 text-red-100">
										{finding.original}
									</del>
									<ins className="rounded bg-emerald-950/25 p-2 text-emerald-100 no-underline">
										{finding.replacement}
									</ins>
								</div>
							</div>
						))}
						{assistance.proposedRevision ? (
							<div className="rounded-lg border border-veud-mint/30 bg-veud-mint/5 p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<strong className="text-veud-cream">
										Proposed full revision
									</strong>
									<Button
										type="button"
										size="sm"
										onClick={() =>
											setDraft(assistance.proposedRevision ?? draft)
										}
									>
										Use proposed draft
									</Button>
								</div>
								<div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
									<div>
										<p className="mb-1 font-bold text-veud-copy">Current</p>
										<p className="whitespace-pre-wrap rounded bg-black/20 p-3">
											{draft}
										</p>
									</div>
									<div>
										<p className="mb-1 font-bold text-veud-copy">Proposed</p>
										<p className="whitespace-pre-wrap rounded bg-black/20 p-3">
											{assistance.proposedRevision}
										</p>
									</div>
								</div>
							</div>
						) : null}
					</div>
				) : null}
			</section>
		</div>
	)
}
