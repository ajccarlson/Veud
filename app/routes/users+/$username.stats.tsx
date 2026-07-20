import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { ProfilePageHeader } from '#app/components/profile-ui.tsx'
import { StatsOverview } from '#app/routes/users+/$username_/stats-overview.tsx'
import { StatsData } from '#app/routes/users+/$username_/stats_/index.tsx'
import { loadProfileAnalytics } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export { ProfileTabErrorBoundary as ErrorBoundary } from '#app/components/profile-ui.tsx'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_stats', 'profile stats loader')
	const analytics = await loadProfileAnalytics(
		request,
		params['username'],
		timings,
	)
	return json(analytics, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

export default function ProfileStats() {
	const shellData = useOutletContext<ProfileShellData>()
	const analyticsData = useLoaderData<typeof loader>()
	const data = { ...shellData, ...analyticsData }
	return (
		<section className="user-landing-stats-page">
			<ProfilePageHeader
				eyebrow="Library insights"
				title="Stats"
				description={`A closer look at ${data.user.name ?? data.user.username}'s scores, progress, and viewing patterns.`}
			/>
			<StatsOverview data={data} />
			<StatsData data={data} />
		</section>
	)
}
