import { useOutletContext } from 'react-router'
import { ProfileDiaryData } from '#app/routes/users+/$username_/journal.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export default function ProfileDiary() {
	const data = useOutletContext<ProfileData>()
	return <ProfileDiaryData data={data} />
}
