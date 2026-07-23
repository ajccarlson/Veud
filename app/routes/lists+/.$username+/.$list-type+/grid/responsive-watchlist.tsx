import {
	Component,
	lazy,
	Suspense,
	useEffect,
	useState,
	type ErrorInfo,
	type ReactNode,
} from 'react'
import { type WatchlistViewProps } from './grid-state.ts'

const DesktopWatchlist = lazy(() =>
	import('./watchlist-grid.tsx').then(module => ({
		default: module.WatchlistGrid,
	})),
)
const MobileWatchlist = lazy(() =>
	import('./mobile-watchlist-cards.tsx').then(module => ({
		default: module.MobileWatchlistView,
	})),
)

class WatchlistModuleBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error(
			'[watchlist] failed to load responsive list module',
			error,
			info,
		)
	}

	render() {
		if (this.state.failed) {
			return (
				<section className="watchlist-module-error" role="alert">
					<h2>The list view could not be loaded</h2>
					<p>Reload the page to retry this part of Veud.</p>
					<button type="button" onClick={() => window.location.reload()}>
						Reload list
					</button>
				</section>
			)
		}
		return this.props.children
	}
}

function WatchlistModuleLoading() {
	return (
		<section
			className="watchlist-module-loading"
			role="status"
			aria-label="Loading list view"
		>
			<span aria-hidden="true" />
			<p>Loading your list…</p>
		</section>
	)
}

export function ResponsiveWatchlist(props: WatchlistViewProps) {
	const [layout, setLayout] = useState<'mobile' | 'desktop' | null>(null)
	const [listEntries, setListEntries] = useState(() => [...props.listEntries])

	useEffect(() => {
		const query = window.matchMedia('(max-width: 56rem)')
		const updateLayout = () => setLayout(query.matches ? 'mobile' : 'desktop')
		updateLayout()
		query.addEventListener('change', updateLayout)
		return () => query.removeEventListener('change', updateLayout)
	}, [])

	useEffect(() => {
		setListEntries([...props.listEntries])
	}, [props.listEntries])

	const viewProps = { ...props, listEntries, setListEntries }

	return (
		<WatchlistModuleBoundary>
			<Suspense fallback={<WatchlistModuleLoading />}>
				{layout === 'mobile' ? (
					<MobileWatchlist {...viewProps} />
				) : layout === 'desktop' ? (
					<DesktopWatchlist {...viewProps} />
				) : (
					<WatchlistModuleLoading />
				)}
			</Suspense>
		</WatchlistModuleBoundary>
	)
}
