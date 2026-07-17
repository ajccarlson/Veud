import { useOutletContext } from '@remix-run/react'
import { StatsData } from '#app/routes/users+/$username_/stats_/index.tsx'
import { StatsOverview } from '#app/routes/users+/$username_/stats-overview.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export default function ProfileStats() {
  const data = useOutletContext<ProfileData>()
  return (
    <>
      <StatsOverview data={data} />
      <StatsData data={data} />
    </>
  )
}
