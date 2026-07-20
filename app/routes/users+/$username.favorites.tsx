import {
	data as json,
	type LoaderFunctionArgs,
	useLoaderData,
	useOutletContext,
} from 'react-router'
import { FavoritesData } from '#app/routes/users+/$username_/body.tsx'
import { loadProfileFavorites } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { type ProfileShellData } from '#app/utils/profile.ts'
import { makeTimings } from '#app/utils/timing.server.ts'

export { ProfileTabErrorBoundary as ErrorBoundary } from '#app/components/profile-ui.tsx'

export async function loader({ params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_favorites', 'profile favorites loader')
	const favorites = await loadProfileFavorites(params['username'], timings)
	return json(favorites, {
		headers: { 'Server-Timing': timings.toString() },
	})
}

export const headers = profileHeaders

export default function ProfileFavorites() {
	const shellData = useOutletContext<ProfileShellData>()
	const favoritesData = useLoaderData<typeof loader>()
	const data = { ...shellData, ...favoritesData }
	return <FavoritesData data={data} />
}
