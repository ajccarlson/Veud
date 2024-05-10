import { OAuth2Strategy } from 'remix-auth-oauth2'
import { z } from 'zod'
import { cache, cachified } from '../cache.server.ts'
import { type Timings } from '../timing.server.ts'
import { type AuthProvider } from './provider.ts'

const MALUserSchema = z.object({ login: z.string() })
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

function generateCodeChallenge(len = 128) {
  let text = ""
  
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
  
  for (var i = 0; i < len; i++)
    text += charset.charAt(Math.floor(Math.random() * charset.length))
  
  return text;
}

// const shouldMock = false
const code_challenge = generateCodeChallenge(128)
const searchParams = new URLSearchParams({ code_challenge })

export class MALProvider implements AuthProvider {
  getAuthStrategy() {
		return new OAuth2Strategy(
			{
        authorizationURL: 'https://myanimelist.net/v1/oauth2/authorize',
        tokenURL: 'https://myanimelist.net/v1/oauth2/token',
				clientID: process.env.MAL_CLIENT_ID,
				clientSecret: process.env.MAL_CLIENT_SECRET,
				callbackURL: `/auth/mal/callback&${searchParams}`,
        responseType: "code",
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
			key: `connection-data:mal:${providerId}`,
			cache,
			timings,
			ttl: 1000 * 60,
			swr: 1000 * 60 * 60 * 24 * 7,
			async getFreshValue(context) {
				const response = await fetch(
					`https://api.myanimelist.net/v2/users/${providerId}`,
					{ headers: { Authorization: `X-MAL-CLIENT-ID ${process.env.MAL_CLIENT_ID}` } },
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
			displayName: result.success ? result.data.login : 'Unknown',
			link: result.success ? `https://myanimelist.net/${result.data.login}` : null,
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
