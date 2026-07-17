import { useOutletContext } from '@remix-run/react'
import { FavoritesData } from '#app/routes/users+/$username_/body.tsx'
import { type ProfileData } from '#app/utils/profile.ts'

export default function ProfileFavorites() {
  const data = useOutletContext<ProfileData>()
  return <FavoritesData data={data} />
}
