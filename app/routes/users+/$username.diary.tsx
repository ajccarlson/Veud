import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { ProfileDiaryData } from '#app/routes/users+/$username_/journal.tsx'
import { loadProfileDiary } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export { ProfileTabErrorBoundary as ErrorBoundary } from '#app/components/profile-ui.tsx'

export async function loader({ params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_diary', 'profile diary loader')
	const diary = await loadProfileDiary(params['username'], timings)
	return json(diary, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

export default function ProfileDiary() {
	const shellData = useOutletContext<ProfileShellData>()
	const diaryData = useLoaderData<typeof loader>()
	const data = { ...shellData, ...diaryData }
	return <ProfileDiaryData data={data} />
}
