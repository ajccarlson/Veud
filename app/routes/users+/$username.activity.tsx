import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { RecentActivityData } from '#app/routes/users+/$username_/body.tsx'
import { loadProfileActivity } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_activity', 'profile activity loader')
	const activity = await loadProfileActivity(
		request,
		params['username'],
		timings,
	)
	return json(activity, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

export default function ProfileActivity() {
	const shellData = useOutletContext<ProfileShellData>()
	const activityData = useLoaderData<typeof loader>()
	const data = { ...shellData, ...activityData }
	return <RecentActivityData data={data} />
}
