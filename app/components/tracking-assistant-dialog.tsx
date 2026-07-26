import { useEffect, useId, useRef } from 'react'
import { useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { type action } from '#app/routes/resources+/tracking-assistant.ts'

const assistantEndpoint = '/resources/tracking-assistant'

export function TrackingAssistantDialog({
	watchlistLabel,
	onLibraryChanged,
}: {
	watchlistLabel: string
	onLibraryChanged?: () => void
}) {
	const fetcher = useFetcher<typeof action>()
	const dialogRef = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	const lastHandledData = useRef<unknown>(null)
	const libraryChanged = useRef(onLibraryChanged)

	const data = fetcher.data
	const busy = fetcher.state !== 'idle'

	useEffect(() => {
		libraryChanged.current = onLibraryChanged
	}, [onLibraryChanged])

	useEffect(() => {
		if (
			data &&
			data !== lastHandledData.current &&
			data.ok &&
			(data.intent === 'apply' || data.intent === 'undo')
		) {
			lastHandledData.current = data
			libraryChanged.current?.()
		}
	}, [data])

	function openAssistant() {
		dialogRef.current?.showModal()
		void fetcher.load(assistantEndpoint)
	}

	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="tracking-assistant-trigger"
				aria-label="Open tracking assistant"
				onClick={openAssistant}
			>
				<Icon name="magic-wand" aria-hidden="true" />
				Assistant
			</Button>

			<dialog
				ref={dialogRef}
				className="tracking-assistant-dialog"
				aria-labelledby={titleId}
			>
				<div className="tracking-assistant-shell">
					<header className="tracking-assistant-header">
						<div>
							<p>{watchlistLabel}</p>
							<h2 id={titleId}>Tracking assistant</h2>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Close tracking assistant"
							onClick={() => dialogRef.current?.close()}
						>
							<span aria-hidden="true">×</span>
						</Button>
					</header>

					{!data && busy ? (
						<div className="tracking-assistant-loading" role="status">
							<span aria-hidden="true" />
							Loading assistant…
						</div>
					) : (
						<>
							<fetcher.Form
								method="post"
								action={assistantEndpoint}
								className="tracking-assistant-command"
							>
								<input type="hidden" name="intent" value="preview" />
								<label htmlFor={`${titleId}-command`}>
									What should Veud change?
								</label>
								<textarea
									id={`${titleId}-command`}
									name="command"
									required
									minLength={3}
									maxLength={800}
									rows={3}
									placeholder="Move Frieren to Watching, mark episode 12 complete, and score it 9."
								/>
								<Button type="submit" disabled={busy || !data?.enabled}>
									{busy && fetcher.formData?.get('intent') === 'preview'
										? 'Building preview…'
										: data?.enabled
											? 'Preview changes'
											: 'Assistant unavailable'}
								</Button>
							</fetcher.Form>

							{data?.error ? (
								<p className="tracking-assistant-message is-error" role="alert">
									{data.error}
								</p>
							) : data?.ok && data.summary ? (
								<p className="tracking-assistant-message" role="status">
									{data.intent === 'undo' ? 'Undone' : 'Applied'}:{' '}
									{data.summary}
								</p>
							) : null}

							<section
								className="tracking-assistant-previews"
								aria-labelledby={`${titleId}-previews`}
							>
								<h3 id={`${titleId}-previews`}>Recent previews</h3>
								{data?.previews.length ? (
									<div className="tracking-assistant-preview-list">
										{data.previews.map(preview => (
											<article
												key={preview.id}
												className="tracking-assistant-preview"
											>
												<header>
													<div>
														<p>“{preview.requestText}”</p>
														<h4>{preview.plan.summary}</h4>
													</div>
													<span>{preview.status}</span>
												</header>

												<ul>
													{preview.plan.operations.map((operation, index) => (
														<li key={`${operation.mediaId}:${index}`}>
															<strong>{operation.mediaTitle}</strong>
															<span>
																{[
																	operation.watchlistLabel
																		? `move to ${operation.watchlistLabel}`
																		: null,
																	operation.score !== null
																		? `score ${operation.score || 'blank'}`
																		: null,
																	operation.progressCurrent !== null
																		? `${operation.progressUnit} ${operation.progressCurrent}`
																		: null,
																	operation.favorite !== null
																		? operation.favorite
																			? 'add favorite'
																			: 'remove favorite'
																		: null,
																	operation.collectionLabel
																		? `add to ${operation.collectionLabel}`
																		: null,
																]
																	.filter(Boolean)
																	.join(' · ')}
															</span>
															{operation.changes.length ? (
																<dl>
																	{operation.changes.map(change => (
																		<div
																			key={`${change.field}:${change.before}:${change.after}`}
																		>
																			<dt>{change.field}</dt>
																			<dd>
																				{change.before} →{' '}
																				<strong>{change.after}</strong>
																			</dd>
																		</div>
																	))}
																</dl>
															) : null}
														</li>
													))}
												</ul>

												<footer>
													{preview.status === 'pending' &&
													new Date(preview.expiresAt) > new Date() ? (
														<fetcher.Form
															method="post"
															action={assistantEndpoint}
														>
															<input
																type="hidden"
																name="intent"
																value="apply"
															/>
															<input
																type="hidden"
																name="previewId"
																value={preview.id}
															/>
															<Button type="submit" size="sm" disabled={busy}>
																Apply
															</Button>
														</fetcher.Form>
													) : null}
													{preview.canUndo ? (
														<fetcher.Form
															method="post"
															action={assistantEndpoint}
														>
															<input type="hidden" name="intent" value="undo" />
															<input
																type="hidden"
																name="previewId"
																value={preview.id}
															/>
															<Button
																type="submit"
																size="sm"
																variant="outline"
																disabled={busy}
															>
																Undo
															</Button>
														</fetcher.Form>
													) : null}
												</footer>
											</article>
										))}
									</div>
								) : (
									<p className="tracking-assistant-empty">No previews yet.</p>
								)}
							</section>
						</>
					)}
				</div>
			</dialog>
		</>
	)
}
