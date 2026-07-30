import { useState } from 'react'
import {
	data as json,
	type LoaderFunctionArgs,
	type MetaFunction,
	type ShouldRevalidateFunctionArgs,
	Link,
	NavLink,
	Outlet,
	useLoaderData,
	useNavigation,
	useRevalidator,
} from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { ReportContentButton } from '#app/components/report-content-button.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
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
	{ to: '.', end: true, label: 'Overview', icon: 'dashboard' },
	{ to: 'activity', end: false, label: 'Journal', icon: 'activity-log' },
	{ to: 'reviews', end: false, label: 'Reviews', icon: 'reader' },
	{ to: 'collections', end: false, label: 'Collections', icon: 'archive' },
	{ to: 'favorites', end: false, label: 'Favorites', icon: 'star' },
	{ to: 'diary', end: false, label: 'Diary', icon: 'file-text' },
	{ to: 'stats', end: false, label: 'Stats', icon: 'bar-chart' },
	{ to: 'social', end: false, label: 'Social', icon: 'chat-bubble' },
] as const

export default function ProfileRoute() {
	const loaderData = useLoaderData<typeof loader>()
	const user = loaderData.user
	const loggedInUser = useOptionalUser()
	const isLoggedInUser = user.id === loggedInUser?.id
	const bannerSrc = getUserBannerSrc(user.banner?.id)
	const revalidator = useRevalidator()
	const [relationshipError, setRelationshipError] = useState<string | null>(
		null,
	)
	const [relationshipBusy, setRelationshipBusy] = useState(false)
	const navigation = useNavigation()
	const isTabLoading =
		navigation.state === 'loading' &&
		Boolean(navigation.location?.pathname.startsWith(`/users/${user.username}`))

	async function toggleFollow() {
		if (relationshipBusy) return
		setRelationshipBusy(true)
		setRelationshipError(null)
		try {
			const response = await fetch('/resources/follow', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					userId: user.id,
					intent: loaderData.isFollowing ? 'unfollow' : 'follow',
				}),
			})
			if (!response.ok) throw new Error('Unable to update this follow.')
			revalidator.revalidate()
		} catch (error) {
			setRelationshipError(
				error instanceof Error
					? error.message
					: 'Unable to update this follow.',
			)
		} finally {
			setRelationshipBusy(false)
		}
	}

	async function toggleSafetyControl(kind: 'mute' | 'block') {
		if (relationshipBusy) return
		const enabled =
			kind === 'mute'
				? !loaderData.safetyState.isMuted
				: !loaderData.safetyState.isBlocked
		if (
			kind === 'block' &&
			enabled &&
			!window.confirm(
				`Block @${user.username}? You will unfollow each other and direct interaction will stop.`,
			)
		) {
			return
		}
		setRelationshipBusy(true)
		setRelationshipError(null)
		try {
			const response = await fetch('/resources/user-safety', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ targetId: user.id, kind, enabled }),
			})
			if (!response.ok) throw new Error(`Unable to ${kind} this member.`)
			revalidator.revalidate()
		} catch (error) {
			setRelationshipError(
				error instanceof Error
					? error.message
					: `Unable to ${kind} this member.`,
			)
		} finally {
			setRelationshipBusy(false)
		}
	}

	return (
		<main
			className={cn('user-landing', !bannerSrc && 'user-landing-no-banner')}
		>
			{/* Hero — banner, identity, and one predictable action group. */}
			<div className="user-landing-hero">
				<div
					className="user-landing-hero-banner"
					style={
						bannerSrc ? { backgroundImage: `url("${bannerSrc}")` } : undefined
					}
				>
					<div className="user-landing-hero-shade" aria-hidden="true" />
				</div>
				<div className="user-landing-hero-body">
					<img
						src={getUserImgSrc(user.image?.id)}
						alt={user.username}
						className="user-landing-hero-avatar"
					/>
					<div className="user-landing-hero-info">
						<h1 className="user-landing-hero-name">{user.username}</h1>
						<span className="user-landing-hero-username">Veud member</span>
						<div className="user-landing-hero-meta">
							<span className="user-landing-hero-joined">
								Joined {loaderData.userJoinedDisplay}
							</span>
							<span className="user-landing-hero-last-active">
								{loaderData.lastActiveDisplay ?? 'Last active unavailable'}
							</span>
						</div>
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
						{isLoggedInUser ? (
							<Button asChild variant="outline">
								<Link to="/settings/profile" prefetch="intent">
									<Icon name="pencil-1" aria-hidden="true" />
									<span>Edit profile</span>
								</Link>
							</Button>
						) : null}
						{loggedInUser && !isLoggedInUser ? (
							<>
								<Button
									variant={loaderData.isFollowing ? 'outline' : 'default'}
									onClick={toggleFollow}
									disabled={
										relationshipBusy ||
										loaderData.safetyState.isBlocked ||
										loaderData.safetyState.isBlockedByTarget
									}
								>
									<Icon
										name={loaderData.isFollowing ? 'check' : 'plus'}
										aria-hidden="true"
									/>
									{loaderData.isFollowing ? 'Unfollow' : 'Follow'}
								</Button>
								<ReportContentButton
									targetType="account"
									targetId={user.id}
									label={`@${user.username}`}
								/>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											size="icon"
											aria-label={`Safety options for @${user.username}`}
											disabled={relationshipBusy}
										>
											<Icon name="dots-horizontal" aria-hidden="true" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											onSelect={() => toggleSafetyControl('mute')}
										>
											{`${loaderData.safetyState.isMuted ? 'Unmute' : 'Mute'} @${user.username}`}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											className="text-red-300"
											onSelect={() => toggleSafetyControl('block')}
										>
											{`${loaderData.safetyState.isBlocked ? 'Unblock' : 'Block'} @${user.username}`}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</>
						) : null}
						<Button
							asChild
							variant={isLoggedInUser ? 'default' : 'outline'}
							className={isLoggedInUser ? 'user-landing-watchlists-action' : ''}
						>
							<Link to={`../../lists/${user.username}`} prefetch="intent">
								<Icon name="list-bullet" aria-hidden="true" />
								Watchlists
							</Link>
						</Button>
						{relationshipError ? (
							<p className="user-landing-action-error" role="alert">
								{relationshipError}
							</p>
						) : null}
					</div>
				</div>
			</div>

			<div className="user-landing-tabs-shell">
				<nav className="user-landing-tabs" aria-label="Profile sections">
					{PROFILE_TABS.map(tab => (
						<NavLink
							key={tab.label}
							to={tab.to}
							end={tab.end}
							prefetch="intent"
							className={({ isActive }) =>
								cn('user-landing-tab', isActive && 'user-landing-tab-active')
							}
						>
							<Icon name={tab.icon} aria-hidden="true" />
							<span>{tab.label}</span>
						</NavLink>
					))}
				</nav>
			</div>

			<div
				className="user-landing-content"
				data-pending={isTabLoading || undefined}
				aria-busy={isTabLoading}
			>
				<div className="user-landing-loading-bar" aria-hidden="true">
					<span />
				</div>
				<span className="sr-only" role="status" aria-live="polite">
					{isTabLoading ? 'Loading profile section' : ''}
				</span>
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
