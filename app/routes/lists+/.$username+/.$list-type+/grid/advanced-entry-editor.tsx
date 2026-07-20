import { useRef, useState, type FormEvent } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { refreshGrid } from './grid-actions.ts'
import { columnParams } from './grid-state.ts'

const categoryScoreFields = [
	'story',
	'character',
	'presentation',
	'sound',
	'performance',
	'enjoyment',
] as const

function scoreValue(value: unknown) {
	const score = Number(value)
	return Number.isFinite(score) && score > 0 ? String(score) : ''
}

function historyForEntry(value: unknown): Record<string, unknown> {
	if (typeof value !== 'string') return {}
	try {
		const parsed = JSON.parse(value)
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {}
	} catch {
		return {}
	}
}

function dateInputValue(value: unknown) {
	if (!value) return ''
	const date = new Date(value as string)
	return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function fieldLabel(field: string) {
	return field.charAt(0).toUpperCase() + field.slice(1)
}

export function AdvancedEntryEditor({ params }: { params: any }) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const data = params.data
	let availableColumns: Record<string, unknown> = {}
	try {
		const parsed: unknown = JSON.parse(columnParams.listTypeData.columns)
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			availableColumns = parsed as Record<string, unknown>
		}
	} catch {}
	const categoryFields = categoryScoreFields.filter(field =>
		Object.hasOwn(availableColumns, field),
	)
	const history = historyForEntry(data.history)

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!data.id || saving) return
		setSaving(true)
		setError('')
		const formData = new FormData(event.currentTarget)
		const fields: Record<string, unknown> = {}

		for (const field of categoryFields) {
			const value = String(formData.get(field) ?? '')
			fields[field] = value ? Number(value) : null
		}
		if (Object.hasOwn(availableColumns, 'personal')) {
			const value = String(formData.get('personal') ?? '')
			fields.personal = value ? Number(value) : null
		}
		if (Object.hasOwn(availableColumns, 'priority')) {
			fields.priority = String(formData.get('priority') ?? '')
		}
		if (Object.hasOwn(availableColumns, 'notes')) {
			fields.notes = String(formData.get('notes') ?? '')
		}
		if (Object.hasOwn(availableColumns, 'startDate')) {
			fields.started = String(formData.get('started') ?? '')
		}
		if (Object.hasOwn(availableColumns, 'finishedDate')) {
			fields.finished = String(formData.get('finished') ?? '')
		}

		try {
			const response = await fetch('/lists/fetch/advanced-edit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ entryId: data.id, fields }),
			})
			if (!response.ok) {
				throw new Error((await response.text()) || 'Could not save this entry')
			}
			dialogRef.current?.close()
			await refreshGrid(columnParams)
		} catch (submitError) {
			setError(
				submitError instanceof Error
					? submitError.message
					: 'Could not save this entry',
			)
		} finally {
			setSaving(false)
		}
	}

	return (
		<>
			<button
				type="button"
				className="ag-row-action-button"
				aria-label={`Quick edit ${data.title || 'entry'}`}
				title="Quick edit"
				onClick={() => {
					setError('')
					dialogRef.current?.showModal()
				}}
			>
				<Icon name="pencil-1" aria-hidden="true" />
			</button>

			<dialog
				ref={dialogRef}
				className="ag-advanced-edit-dialog"
				onCancel={() => setError('')}
			>
				<form onSubmit={handleSubmit} className="ag-advanced-edit-form">
					<header className="ag-advanced-edit-header">
						<div>
							<p className="ag-advanced-edit-eyebrow">Quick edit</p>
							<h2>{data.title || 'List entry'}</h2>
						</div>
						<button
							type="button"
							className="ag-advanced-edit-close"
							aria-label="Close quick edit"
							onClick={() => dialogRef.current?.close()}
						>
							×
						</button>
					</header>

					{categoryFields.length ||
					Object.hasOwn(availableColumns, 'personal') ? (
						<fieldset>
							<legend>Scores</legend>
							<div className="ag-advanced-edit-score-grid">
								{categoryFields.map(field => (
									<label key={field}>
										<span>{fieldLabel(field)}</span>
										<Input
											name={field}
											type="number"
											min="1"
											max="10"
											step="1"
											defaultValue={scoreValue(data[field])}
										/>
									</label>
								))}
								{Object.hasOwn(availableColumns, 'personal') ? (
									<label>
										<span>Personal</span>
										<Input
											name="personal"
											type="number"
											min="1"
											max="10"
											step="0.1"
											defaultValue={scoreValue(data.personal)}
										/>
									</label>
								) : null}
							</div>
						</fieldset>
					) : null}

					{Object.hasOwn(availableColumns, 'startDate') ||
					Object.hasOwn(availableColumns, 'finishedDate') ? (
						<fieldset>
							<legend>Dates</legend>
							<div className="ag-advanced-edit-date-grid">
								{Object.hasOwn(availableColumns, 'startDate') ? (
									<label>
										<span>Started</span>
										<Input
											name="started"
											type="date"
											defaultValue={dateInputValue(history.started)}
										/>
									</label>
								) : null}
								{Object.hasOwn(availableColumns, 'finishedDate') ? (
									<label>
										<span>Finished</span>
										<Input
											name="finished"
											type="date"
											defaultValue={dateInputValue(history.finished)}
										/>
									</label>
								) : null}
							</div>
						</fieldset>
					) : null}

					{Object.hasOwn(availableColumns, 'priority') ? (
						<label className="ag-advanced-edit-field">
							<span>Priority</span>
							<select name="priority" defaultValue={data.priority ?? ''}>
								<option value="">None</option>
								<option value="Low">Low</option>
								<option value="Medium">Medium</option>
								<option value="High">High</option>
							</select>
						</label>
					) : null}

					{Object.hasOwn(availableColumns, 'notes') ? (
						<label className="ag-advanced-edit-field">
							<span>Notes</span>
							<Textarea
								name="notes"
								maxLength={5000}
								defaultValue={data.notes ?? ''}
							/>
						</label>
					) : null}

					{error ? (
						<p role="alert" className="ag-advanced-edit-error">
							{error}
						</p>
					) : null}
					<footer className="ag-advanced-edit-footer">
						<Button
							type="button"
							variant="ghost"
							onClick={() => dialogRef.current?.close()}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving…' : 'Save changes'}
						</Button>
					</footer>
				</form>
			</dialog>
		</>
	)
}
