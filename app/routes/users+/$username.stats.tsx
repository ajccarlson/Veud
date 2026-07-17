import { useOutletContext } from '@remix-run/react'
import { StatsData } from '#app/routes/users+/$username_/stats_/index.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export default function ProfileStats() {
  const data = useOutletContext<ProfileData>()
  return <StatsData data={data} />
}
