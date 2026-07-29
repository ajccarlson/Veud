import { Component, type ErrorInfo, type ReactNode } from 'react'

export type ProfileChartDataRow = {
	key: string
	cells: readonly ReactNode[]
}

export function ProfileChartDataTable({
	label,
	columns,
	rows,
	emptyText = 'No values.',
}: {
	label: string
	columns: readonly string[]
	rows: readonly ProfileChartDataRow[]
	emptyText?: string
}) {
	return (
		<table className="sr-only">
			<caption>{label}</caption>
			<thead>
				<tr>
					{columns.map(column => (
						<th key={column} scope="col">
							{column}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.length ? (
					rows.map(row => (
						<tr key={row.key}>
							{row.cells.map((cell, index) => (
								<td key={`${row.key}:${columns[index] ?? index}`}>{cell}</td>
							))}
						</tr>
					))
				) : (
					<tr>
						<td colSpan={Math.max(1, columns.length)}>{emptyText}</td>
					</tr>
				)}
			</tbody>
		</table>
	)
}

export class ProfileVisualizationBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('[profile] failed to load visualization module', error, info)
	}

	render() {
		if (this.state.failed) {
			return (
				<section className="user-landing-chart-error" role="alert">
					<h3>This visualization could not be loaded</h3>
					<p>Reload the profile to retry the chart.</p>
					<button type="button" onClick={() => window.location.reload()}>
						Reload profile
					</button>
				</section>
			)
		}
		return this.props.children
	}
}

export function ProfileVisualizationLoading({ label }: { label: string }) {
	return (
		<div className="user-landing-chart-loading" role="status">
			<span aria-hidden="true" />
			<p>Loading {label.toLocaleLowerCase()}…</p>
		</div>
	)
}
