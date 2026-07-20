import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { ProfileReviewsData } from '#app/routes/users+/$username_/journal.tsx'
import { loadProfileReviews } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export async function loader({ params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_reviews', 'profile reviews loader')
	const reviews = await loadProfileReviews(params['username'], timings)
	return json(reviews, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

export default function ProfileReviews() {
	const shellData = useOutletContext<ProfileShellData>()
	const reviewsData = useLoaderData<typeof loader>()
	const data = { ...shellData, ...reviewsData }
	return <ProfileReviewsData data={data} />
}
