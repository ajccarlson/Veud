import { afterEach, describe, expect, test, vi } from 'vitest'
import { onboardingEmailSessionKey } from '#app/routes/_auth+/onboarding.tsx'
import { handleVerification as handleProviderOnboardingVerification } from '#app/routes/_auth+/onboarding_.$provider.server.ts'
import {
	providerIdKey,
	providerNameKey,
} from '#app/routes/_auth+/onboarding_.$provider.tsx'
import { type VerifyFunctionArgs } from '#app/routes/_auth+/verify.server.ts'
import { verifySessionStorage } from '../verification.server.ts'
import { getGitHubProviderUser, GitHubProvider } from './github.server.ts'
import { getMALProviderUser, MALProvider } from './mal.server.ts'
import { getTraktProviderUser } from './trakt.server.ts'

afterEach(() => {
	vi.unstubAllEnvs()
})

function jsonResponse(value: unknown) {
	return new Response(JSON.stringify(value), {
		headers: { 'content-type': 'application/json' },
	})
}

describe('OAuth provider profiles', () => {
	test('maps the authenticated MyAnimeList profile', async () => {
		const fetcher = vi.fn<typeof fetch>()
		fetcher.mockResolvedValue(
			jsonResponse({
				id: 42,
				name: 'MAL_User',
				picture: 'https://cdn.myanimelist.net/profile.jpg',
			}),
		)

		await expect(getMALProviderUser('mal-token', fetcher)).resolves.toEqual({
			id: '42',
			username: 'MAL_User',
			name: 'MAL_User',
			imageUrl: 'https://cdn.myanimelist.net/profile.jpg',
		})
		const [url, init] = fetcher.mock.calls[0]
		expect(url).toBe(
			'https://api.myanimelist.net/v2/users/@me?fields=id,name,picture',
		)
		expect(new Headers(init?.headers).get('authorization')).toBe(
			'Bearer mal-token',
		)
	})

	test('maps Trakt settings and sends the required API headers', async () => {
		vi.stubEnv('TRAKT_API_KEY', 'trakt-client-id')
		const fetcher = vi.fn<typeof fetch>()
		fetcher.mockResolvedValue(
			jsonResponse({
				user: {
					username: 'trakt_user',
					name: 'Trakt User',
					ids: { trakt: 84, slug: 'trakt-user', uuid: 'uuid-84' },
					images: { avatar: { full: 'images.trakt.tv/avatar.webp' } },
				},
			}),
		)

		await expect(getTraktProviderUser('trakt-token', fetcher)).resolves.toEqual(
			{
				id: 'trakt-user',
				username: 'trakt_user',
				name: 'Trakt User',
				imageUrl: 'https://images.trakt.tv/avatar.webp',
			},
		)
		const [, init] = fetcher.mock.calls[0]
		const headers = new Headers(init?.headers)
		expect(headers.get('authorization')).toBe('Bearer trakt-token')
		expect(headers.get('trakt-api-key')).toBe('trakt-client-id')
		expect(headers.get('trakt-api-version')).toBe('2')
	})

	test('uses GitHub primary verified email', async () => {
		const fetcher = vi.fn<typeof fetch>()
		fetcher
			.mockResolvedValueOnce(
				jsonResponse({
					id: 21,
					login: 'OctoCat',
					name: 'Octo Cat',
					avatar_url: 'https://github.com/avatar.png',
					email: null,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{ email: 'other@example.com', primary: false, verified: true },
					{ email: 'Octo@Example.com', primary: true, verified: true },
				]),
			)

		await expect(
			getGitHubProviderUser('github-token', fetcher),
		).resolves.toEqual({
			id: '21',
			email: 'octo@example.com',
			username: 'OctoCat',
			name: 'Octo Cat',
			imageUrl: 'https://github.com/avatar.png',
		})
		expect(fetcher).toHaveBeenCalledTimes(2)
		for (const [, init] of fetcher.mock.calls) {
			expect(new Headers(init?.headers).get('authorization')).toBe(
				'Bearer github-token',
			)
		}
	})
})

describe('OAuth flow state', () => {
	test('starts MyAnimeList with its required plain PKCE challenge', async () => {
		vi.stubEnv('NODE_ENV', 'test')
		vi.stubEnv('MAL_CLIENT_ID', 'mal-client-id')
		vi.stubEnv('MAL_CLIENT_SECRET', 'mal-client-secret')

		const result = await new MALProvider()
			.getAuthStrategy()
			.authenticate(
				new Request('https://veud.test/auth/mal', { method: 'POST' }),
			)
			.catch(error => error)
		expect(result).toBeInstanceOf(Response)
		if (!(result instanceof Response)) throw result

		const location = new URL(result.headers.get('location') ?? '')
		expect(location.origin + location.pathname).toBe(
			'https://myanimelist.net/v1/oauth2/authorize',
		)
		expect(location.searchParams.get('code_challenge_method')).toBe('plain')
		expect(location.searchParams.get('redirect_uri')).toBe('/auth/mal/callback')
		const setCookie = result.headers.get('set-cookie')
		expect(setCookie).toContain('en_oauth2_mal:')
		expect(setCookie).toContain('HttpOnly')
		expect(setCookie).toContain('SameSite=Lax')
	})

	test('starts GitHub with profile and email scopes', async () => {
		vi.stubEnv('NODE_ENV', 'test')
		vi.stubEnv('GITHUB_CLIENT_ID', 'github-client-id')
		vi.stubEnv('GITHUB_CLIENT_SECRET', 'github-client-secret')

		const result = await new GitHubProvider()
			.getAuthStrategy()
			.authenticate(
				new Request('https://veud.test/auth/github', { method: 'POST' }),
			)
			.catch(error => error)
		expect(result).toBeInstanceOf(Response)
		if (!(result instanceof Response)) throw result

		const location = new URL(result.headers.get('location') ?? '')
		expect(location.searchParams.get('scope')).toBe('read:user user:email')
		expect(result.headers.get('set-cookie')).toContain('en_oauth2_github=')
	})
})

test('verified provider email resumes provider onboarding', async () => {
	const verifySession = await verifySessionStorage.getSession()
	verifySession.set(providerNameKey, 'mal')
	verifySession.set(providerIdKey, '42')
	const setCookie = await verifySessionStorage.commitSession(verifySession)
	const cookie = setCookie.slice(0, setCookie.indexOf(';'))
	const submission = {
		status: 'success',
		value: { target: 'new-user@example.com' },
	} as unknown as VerifyFunctionArgs['submission']

	const response = await handleProviderOnboardingVerification({
		request: new Request('https://veud.test/verify', {
			headers: { cookie },
		}),
		body: new FormData(),
		submission,
	})

	expect(response.status).toBe(302)
	expect(response.headers.get('location')).toBe('/onboarding/mal')
	const nextSetCookie = response.headers.get('set-cookie') ?? ''
	const nextCookie = nextSetCookie.slice(0, nextSetCookie.indexOf(';'))
	const restoredSession = await verifySessionStorage.getSession(nextCookie)
	expect(restoredSession.get(onboardingEmailSessionKey)).toBe(
		'new-user@example.com',
	)
})
