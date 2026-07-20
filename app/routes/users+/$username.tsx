import {
	data as json,
	type LoaderFunctionArgs,
	type MetaFunction,
	type ShouldRevalidateFunctionArgs,
	Link,
	NavLink,
	Outlet,
	useLoaderData,
	useRevalidator,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { getLastActiveLabel } from '#app/utils/last-active.ts'
import { cn, getUserBannerSrc, getUserImgSrc } from '#app/utils/misc.tsx'
import { loadProfileShell } from '#app/utils/profile-data.server.ts'
import { profileHeaders } from '#app/utils/profile-headers.ts'
import { makeTimings } from '#app/utils/timing.server.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import '#app/styles/user-landing.scss'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const timings = makeTimings('profile_shell', 'profile shell loader')
	const { lastActiveAt, ...shell } = await loadProfileShell(
		request,
		params['username'],
		timings,
	)

	return json(
		{
			...shell,
			lastActiveDisplay: getLastActiveLabel(lastActiveAt),
		},
		{ headers: { 'Server-Timing': timings.toString() } },
	)
}

export const headers = profileHeaders

/** The profile shell is stable while only the active child tab changes. */
export function shouldRevalidate({
	currentParams,
	nextParams,
	currentUrl,
	nextUrl,
	formMethod,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	const isSameProfile = currentParams['username'] === nextParams['username']
	const isTabNavigation = currentUrl.pathname !== nextUrl.pathname
	if (isSameProfile && isTabNavigation && !formMethod) return false
	return defaultShouldRevalidate
}

const PROFILE_TABS = [
	{ to: '.', end: true, label: 'Overview' },
	{ to: 'reviews', end: false, label: 'Reviews' },
	{ to: 'diary', end: false, label: 'Diary' },
	{ to: 'collections', end: false, label: 'Collections' },
	{ to: 'stats', end: false, label: 'Stats' },
	{ to: 'favorites', end: false, label: 'Favorites' },
	{ to: 'activity', end: false, label: 'Activity' },
	{ to: 'social', end: false, label: 'Social' },
]

export default function ProfileRoute() {
	const loaderData = useLoaderData<typeof loader>()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = user.id === loggedInUser?.id
	const bannerSrc = getUserBannerSrc(user.banner?.id)
	const revalidator = useRevalidator()

	async function toggleFollow() {
		await fetch(
			'/resources/follow/' +
				encodeURIComponent(
					new URLSearchParams({
						userId: user.id,
						intent: loaderData.isFollowing ? 'unfollow' : 'follow',
					}).toString(),
				),
			{ method: 'POST' },
		)
		revalidator.revalidate()
	}

	return (
		<main
			className={cn('user-landing')}
			style={{
				width: '100%',
				minHeight: '100%',
				backgroundColor: 'var(--veud-bg)',
			}}
		>
			{/* Hero — banner + avatar + identity, with an edit action on your own profile. */}
			<div className="user-landing-hero">
				<div
					className="user-landing-hero-banner"
					style={
						bannerSrc ? { backgroundImage: `url("${bannerSrc}")` } : undefined
					}
				>
					{isLoggedInUser ? (
						<div className="user-landing-hero-actions">
							<Button asChild variant="outline">
								<Link to="/settings/profile" prefetch="intent">
									Edit profile
								</Link>
							</Button>
						</div>
					) : null}
				</div>
				<div className="user-landing-hero-body">
					<img
						src={getUserImgSrc(user.image?.id)}
						alt={user.username}
						className="user-landing-hero-avatar"
					/>
					<div className="user-landing-hero-info">
						<h1 className="user-landing-hero-name">
							{user.name ?? user.username}
						</h1>
						<span className="user-landing-hero-username">@{user.username}</span>
						<span className="user-landing-hero-joined">
							Joined {loaderData.userJoinedDisplay}
						</span>
						<span className="user-landing-hero-last-active">
							{loaderData.lastActiveDisplay ?? 'Last active unavailable'}
						</span>
						<div className="user-landing-hero-stats">
							<span>
								<strong>{loaderData.followerCount}</strong>{' '}
								{loaderData.followerCount === 1 ? 'follower' : 'followers'}
							</span>
							<span>
								<strong>{loaderData.followingCount}</strong> following
							</span>
						</div>
					</div>
					<div className="user-landing-hero-side">
						{loggedInUser && !isLoggedInUser ? (
							<Button
								variant={loaderData.isFollowing ? 'outline' : 'default'}
								onClick={toggleFollow}
							>
								{loaderData.isFollowing ? 'Unfollow' : 'Follow'}
							</Button>
						) : null}
						<Button asChild>
							<Link to={`../../lists/${user.username}`} prefetch="intent">
								Watchlists
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<nav
				className="mx-auto mt-6 flex flex-wrap justify-center gap-2 px-4"
				style={{ borderBottom: '1px solid var(--veud-surface)' }}
			>
				{PROFILE_TABS.map(tab => (
					<NavLink
						key={tab.label}
						to={tab.to}
						end={tab.end}
						prefetch="intent"
						className="px-4 py-2 font-semibold transition-colors"
						style={({ isActive }) => ({
							borderBottom: isActive
								? '4px solid var(--veud-teal)'
								: '4px solid transparent',
							color: isActive ? 'var(--veud-highlight)' : 'var(--veud-cream)',
						})}
					>
						{tab.label}
					</NavLink>
				))}
			</nav>

			<div style={{ padding: '1rem' }}>
				<Outlet context={loaderData} />
			</div>
		</main>
	)
}

export const meta: MetaFunction<typeof loader> = ({ params }) => {
	const displayName = params['username']
	return [
		{ title: `${displayName} | Veud` },
		{
			name: 'description',
			content: `Profile of ${displayName} on Veud`,
		},
	]
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>No user with the username "{params['username']}" exists</p>
				),
			}}
		/>
	)
}
