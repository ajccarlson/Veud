import { createId as cuid } from '@paralleldrive/cuid2'
import { redirect } from 'react-router'
import { GitHubStrategy } from 'remix-auth-github'
import { z } from 'zod'
import { cache, cachified } from '../cache.server.ts'
import { connectionSessionStorage } from '../connections.server.ts'
import { type Timings } from '../timing.server.ts'
<<<<<<< HEAD
import { type AuthProvider, type ProviderUser } from './provider.ts'
=======
import {
	type AuthProvider,
	getOAuthCookie,
	type ProviderUser,
} from './provider.ts'
>>>>>>> develop

const GitHubUserSchema = z.object({ login: z.string() })
const GitHubProfileSchema = z.object({
	id: z.union([z.number().int(), z.string().min(1)]),
	login: z.string().min(1),
	name: z.string().nullable().optional(),
	avatar_url: z.string().url().optional(),
	email: z.string().email().nullable().optional(),
})
const GitHubEmailsSchema = z.array(
	z.object({
		email: z.string().email(),
		primary: z.boolean(),
		verified: z.boolean(),
	}),
)
const GitHubUserParseResult = z
	.object({
		success: z.literal(true),
		data: GitHubUserSchema,
	})
	.or(
		z.object({
			success: z.literal(false),
		}),
	)

const shouldMock = process.env.GITHUB_CLIENT_ID?.startsWith('MOCK_')

export class GitHubProvider implements AuthProvider {
	getAuthStrategy() {
		return new GitHubStrategy<ProviderUser>(
			{
<<<<<<< HEAD
				clientId: process.env.GITHUB_CLIENT_ID,
				clientSecret: process.env.GITHUB_CLIENT_SECRET,
				redirectURI: '/auth/github/callback',
			},
			async ({ profile }) => {
				const email = profile.emails[0].value.trim().toLowerCase()
				const username = profile.displayName
				const imageUrl = profile.photos[0].value
				return {
					email,
					id: profile.id,
					username,
					name: profile.name.givenName,
					imageUrl,
				}
=======
				cookie: getOAuthCookie('github'),
				clientId: process.env.GITHUB_CLIENT_ID,
				clientSecret: process.env.GITHUB_CLIENT_SECRET,
				redirectURI: '/auth/github/callback',
				scopes: ['read:user', 'user:email'],
>>>>>>> develop
			},
			async ({ tokens }) => getGitHubProviderUser(tokens.accessToken()),
		)
	}

	async resolveConnectionData(
		providerId: string,
		{ timings }: { timings?: Timings } = {},
	) {
		const result = await cachified({
			key: `connection-data:github:${providerId}`,
			cache,
			timings,
			ttl: 1000 * 60,
			swr: 1000 * 60 * 60 * 24 * 7,
			async getFreshValue(context) {
				const response = await fetch(
					`https://api.github.com/user/${providerId}`,
					{ headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
				)
				const rawJson = await response.json()
				const result = GitHubUserSchema.safeParse(rawJson)
				if (!result.success) {
					// if it was unsuccessful, then we should kick it out of the cache
					// asap and try again.
					context.metadata.ttl = 0
				}
				return result
			},
			checkValue: GitHubUserParseResult,
		})
		return {
			displayName: result.success ? result.data.login : 'Unknown',
			link: result.success ? `https://github.com/${result.data.login}` : null,
		} as const
	}

	async handleMockAction(request: Request) {
		if (!shouldMock) return

		const connectionSession = await connectionSessionStorage.getSession(
			request.headers.get('cookie'),
		)
		const state = cuid()
		connectionSession.set('oauth2:state', state)
		const code = 'MOCK_CODE_GITHUB_KODY'
		const searchParams = new URLSearchParams({ code, state })
		throw redirect(`/auth/github/callback?${searchParams}`, {
			headers: {
				'set-cookie':
					await connectionSessionStorage.commitSession(connectionSession),
			},
		})
	}
}

export async function getGitHubProviderUser(
	accessToken: string,
	fetcher: typeof fetch = fetch,
): Promise<ProviderUser> {
	const headers = {
		Accept: 'application/vnd.github+json',
		Authorization: `Bearer ${accessToken}`,
		'X-GitHub-Api-Version': '2022-11-28',
	}
	const [profileResponse, emailsResponse] = await Promise.all([
		fetcher('https://api.github.com/user', { headers }),
		fetcher('https://api.github.com/user/emails', { headers }),
	])
	if (!profileResponse.ok) {
		throw new Error(
			`GitHub profile request failed with status ${profileResponse.status}`,
		)
	}
	if (!emailsResponse.ok) {
		throw new Error(
			`GitHub email request failed with status ${emailsResponse.status}`,
		)
	}

	const profile = GitHubProfileSchema.parse(await profileResponse.json())
	const emails = GitHubEmailsSchema.parse(await emailsResponse.json())
	const email =
		emails.find(candidate => candidate.primary && candidate.verified)?.email ??
		profile.email ??
		undefined

	return {
		id: String(profile.id),
		email: email?.trim().toLowerCase(),
		username: profile.login,
		name: profile.name ?? profile.login,
		imageUrl: profile.avatar_url,
	}
}
