import { CodeChallengeMethod, OAuth2Strategy } from 'remix-auth-oauth2'
import { z } from 'zod'
import { cache, cachified } from '../cache.server.ts'
import { type Timings } from '../timing.server.ts'
import {
	type AuthProvider,
	getOAuthCookie,
	type ProviderUser,
} from './provider.ts'

const MALProfileSchema = z.object({
	id: z.number().int(),
	name: z.string().min(1),
	picture: z.string().url().optional(),
})

const MALUserSchema = z.object({ name: z.string() })
const MALUserParseResult = z
	.object({
		success: z.literal(true),
		data: MALUserSchema,
	})
	.or(
		z.object({
			success: z.literal(false),
		}),
	)

export class MALProvider implements AuthProvider {
	getAuthStrategy() {
		return new OAuth2Strategy<ProviderUser>(
			{
				authorizationEndpoint: 'https://myanimelist.net/v1/oauth2/authorize',
				codeChallengeMethod: CodeChallengeMethod.Plain,
				cookie: getOAuthCookie('mal'),
				clientId: process.env.MAL_CLIENT_ID,
				clientSecret: process.env.MAL_CLIENT_SECRET,
				redirectURI: '/auth/mal/callback',
				tokenEndpoint: 'https://myanimelist.net/v1/oauth2/token',
			},
			async ({ tokens }) => getMALProviderUser(tokens.accessToken()),
		)
	}

	async resolveConnectionData(
		providerId: string,
		{ timings }: { timings?: Timings } = {},
	) {
		const result = await cachified({
			key: `connection-data:mal:${providerId}`,
			cache,
			timings,
			ttl: 1000 * 60,
			swr: 1000 * 60 * 60 * 24 * 7,
			async getFreshValue(context) {
				const response = await fetch(
					`https://api.myanimelist.net/v2/users/${providerId}`,
					{ headers: { 'X-MAL-CLIENT-ID': process.env.MAL_CLIENT_ID } },
				)
				const rawJson = await response.json()
				const result = MALUserSchema.safeParse(rawJson)
				if (!result.success) {
					// if it was unsuccessful, then we should kick it out of the cache
					// asap and try again.
					context.metadata.ttl = 0
				}
				return result
			},
			checkValue: MALUserParseResult,
		})
		return {
			displayName: result.success ? result.data.name : 'Unknown',
			link: result.success
				? `https://myanimelist.net/profile/${result.data.name}`
				: null,
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

export async function getMALProviderUser(
	accessToken: string,
	fetcher: typeof fetch = fetch,
): Promise<ProviderUser> {
	const response = await fetcher(
		'https://api.myanimelist.net/v2/users/@me?fields=id,name,picture',
		{
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
		},
	)
	if (!response.ok) {
		throw new Error(
			`MyAnimeList profile request failed with status ${response.status}`,
		)
	}

	const profile = MALProfileSchema.parse(await response.json())
	return {
		id: String(profile.id),
		username: profile.name,
		name: profile.name,
		imageUrl: profile.picture,
	}
}
