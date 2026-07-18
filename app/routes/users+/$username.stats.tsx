import { useOutletContext } from 'react-router'
import { StatsOverview } from '#app/routes/users+/$username_/stats-overview.tsx'
import { StatsData } from '#app/routes/users+/$username_/stats_/index.tsx'
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
