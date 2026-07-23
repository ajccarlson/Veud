import { lazy, Suspense, useState } from 'react'
import { Icon } from '#app/components/ui/icon.tsx'

const DeferredAdvancedEntryEditor = lazy(() =>
	import('./advanced-entry-editor.tsx').then(module => ({
		default: module.AdvancedEntryEditor,
	})),
)

export function openAdvancedEntryEditor(entryId: string, idPrefix = '') {
	document
		.getElementById(`advanced-entry-editor-trigger-${idPrefix}${entryId}`)
		?.click()
}

export function AdvancedEntryEditorTrigger({
	params,
	idPrefix = '',
}: {
	params: any
	idPrefix?: string
}) {
	const [requestCount, setRequestCount] = useState(0)
	const entryId = String(params.data.id ?? '')

	return (
		<>
			<button
				id={`advanced-entry-editor-trigger-${idPrefix}${entryId}`}
				type="button"
				className="ag-row-action-button"
				aria-label={`Quick edit ${params.data.title || 'entry'}`}
				title="Quick edit"
				onClick={() => setRequestCount(current => current + 1)}
			>
				<Icon name="pencil-1" aria-hidden="true" />
			</button>
			{requestCount > 0 ? (
				<Suspense
					fallback={
						<span className="sr-only" role="status">
							Loading quick editor…
						</span>
					}
				>
					<DeferredAdvancedEntryEditor
						params={params}
						idPrefix={idPrefix}
						openRequest={requestCount}
						showTrigger={false}
					/>
				</Suspense>
			) : null}
		</>
	)
}
