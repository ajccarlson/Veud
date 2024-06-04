import { OAuth2Strategy } from 'remix-auth-oauth2'
import { z } from 'zod'
import { cache, cachified } from '../cache.server.ts'
import { type Timings } from '../timing.server.ts'
import { type AuthProvider } from './provider.ts'

const TraktUserSchema = z.object({ login: z.string() })
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
		return new OAuth2Strategy(
			{
        authorizationURL: 'https://api.trakt.tv/oauth/authorize',
        tokenURL: 'https://api.trakt.tv/oauth/token',
				clientID: process.env.TRAKT_API_KEY,
				clientSecret: process.env.TRAKT_CLIENT_SECRET,
				callbackURL: '/auth/trakt/callback',
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
					{ headers: { Authorization: `token ${process.env.TRAKT_API_KEY}` } },
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
			displayName: result.success ? result.data.login : 'Unknown',
			link: result.success ? `https://trakt.tv/${result.data.login}` : null,
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
