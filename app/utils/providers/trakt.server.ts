<<<<<<< HEAD
import { OAuth2Strategy, type OAuth2Profile } from 'remix-auth-oauth2'
import { z } from 'zod'
import { cache, cachified } from '../cache.server.ts'
import { type Timings } from '../timing.server.ts'
import { type AuthProvider, type ProviderUser } from './provider.ts'

const TraktUserSchema = z.object({ login: z.string() })
=======
import { OAuth2Strategy } from 'remix-auth-oauth2'
import { z } from 'zod'
import { cache, cachified } from '../cache.server.ts'
import { type Timings } from '../timing.server.ts'
import {
	type AuthProvider,
	getOAuthCookie,
	type ProviderUser,
} from './provider.ts'

const TraktSettingsSchema = z.object({
	user: z.object({
		username: z.string().min(1),
		name: z.string().nullable().optional(),
		ids: z.object({
			slug: z.string().min(1),
		}),
		images: z
			.object({ avatar: z.object({ full: z.string().min(1) }) })
			.optional(),
	}),
})

const TraktUserSchema = z.object({ username: z.string() })
>>>>>>> develop
const TraktUserParseResult = z
	.object({
		success: z.literal(true),
		data: TraktUserSchema,
	})
	.or(
		z.object({
			success: z.literal(false),
		}),
	)

// const shouldMock = false

export class TraktProvider implements AuthProvider {
	getAuthStrategy() {
<<<<<<< HEAD
		return new OAuth2Strategy<ProviderUser, OAuth2Profile>(
			{
        authorizationEndpoint: 'https://api.trakt.tv/oauth/authorize',
        tokenEndpoint: 'https://api.trakt.tv/oauth/token',
				clientId: process.env.TRAKT_API_KEY,
				clientSecret: process.env.TRAKT_CLIENT_SECRET,
				redirectURI: '/auth/trakt/callback',
			},
			async ({ profile }) => {
				const email = profile.emails![0].value.trim().toLowerCase()
				const username = profile.displayName
				const imageUrl = profile.photos![0].value
				return {
					email,
					id: profile.id!,
					username,
					name: profile.name!.givenName,
					imageUrl,
				}
			},
=======
		return new OAuth2Strategy<ProviderUser>(
			{
				authorizationEndpoint: 'https://trakt.tv/oauth/authorize',
				cookie: getOAuthCookie('trakt'),
				clientId: process.env.TRAKT_API_KEY,
				clientSecret: process.env.TRAKT_CLIENT_SECRET,
				redirectURI: '/auth/trakt/callback',
				tokenEndpoint: 'https://api.trakt.tv/oauth/token',
			},
			async ({ tokens }) => getTraktProviderUser(tokens.accessToken()),
>>>>>>> develop
		)
	}

	async resolveConnectionData(
		providerId: string,
		{ timings }: { timings?: Timings } = {},
	) {
		const result = await cachified({
			key: `connection-data:trakt:${providerId}`,
			cache,
			timings,
			ttl: 1000 * 60,
			swr: 1000 * 60 * 60 * 24 * 7,
			async getFreshValue(context) {
				const response = await fetch(
					`https://api.trakt.tv/users/${providerId}`,
<<<<<<< HEAD
					{ headers: { Authorization: `token ${process.env.TRAKT_API_KEY}` } },
=======
					{
						headers: {
							'trakt-api-key': process.env.TRAKT_API_KEY,
							'trakt-api-version': '2',
						},
					},
>>>>>>> develop
				)
				const rawJson = await response.json()
				const result = TraktUserSchema.safeParse(rawJson)
				if (!result.success) {
					// if it was unsuccessful, then we should kick it out of the cache
					// asap and try again.
					context.metadata.ttl = 0
				}
				return result
			},
			checkValue: TraktUserParseResult,
		})
		return {
<<<<<<< HEAD
			displayName: result.success ? result.data.login : 'Unknown',
			link: result.success ? `https://trakt.tv/${result.data.login}` : null,
=======
			displayName: result.success ? result.data.username : 'Unknown',
			link: result.success ? `https://trakt.tv/${result.data.username}` : null,
>>>>>>> develop
		} as const
	}

	async handleMockAction(request: Request) {
		// if (!shouldMock) return

		// const connectionSession = await connectionSessionStorage.getSession(
		// 	request.headers.get('cookie'),
		// )
		// const state = cuid()
		// connectionSession.set('oauth2:state', state)
		// const code = 'MOCK_CODE_GITHUB_KODY'
		// const searchParams = new URLSearchParams({ code, state })
		// throw redirect(`/auth/github/callback?${searchParams}`, {
		// 	headers: {
		// 		'set-cookie':
		// 			await connectionSessionStorage.commitSession(connectionSession),
		// 	},
		// })
	}
}
<<<<<<< HEAD
=======

export async function getTraktProviderUser(
	accessToken: string,
	fetcher: typeof fetch = fetch,
): Promise<ProviderUser> {
	const response = await fetcher(
		'https://api.trakt.tv/users/settings?extended=full',
		{
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
				'trakt-api-key': process.env.TRAKT_API_KEY,
				'trakt-api-version': '2',
			},
		},
	)
	if (!response.ok) {
		throw new Error(
			`Trakt profile request failed with status ${response.status}`,
		)
	}

	const { user } = TraktSettingsSchema.parse(await response.json())
	const image = user.images?.avatar.full
	return {
		id: user.ids.slug,
		username: user.username,
		name: user.name ?? user.username,
		imageUrl: image
			? image.startsWith('http://') || image.startsWith('https://')
				? image
				: `https://${image}`
			: undefined,
	}
}
>>>>>>> develop
