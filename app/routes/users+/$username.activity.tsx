import { useOutletContext } from 'react-router'
import { RecentActivityData } from '#app/routes/users+/$username_/body.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export default function ProfileActivity() {
  const data = useOutletContext<ProfileData>()
  return <RecentActivityData data={data} />
}
