import { Component, type ErrorInfo, type ReactNode } from 'react'

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
