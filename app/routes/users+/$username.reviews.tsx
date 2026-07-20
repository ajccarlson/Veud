import { useOutletContext } from 'react-router'
import { ProfileReviewsData } from '#app/routes/users+/$username_/journal.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export default function ProfileReviews() {
	const data = useOutletContext<ProfileData>()
	return <ProfileReviewsData data={data} />
}
