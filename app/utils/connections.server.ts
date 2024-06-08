import { createCookieSessionStorage } from '@remix-run/node'
import { type ProviderName } from './connections.tsx'
// import { GitHubProvider } from './providers/github.server.ts'
import { MALProvider } from './providers/mal.server.ts'
import { type AuthProvider } from './providers/provider.ts'
import { TraktProvider } from './providers/trakt.server.ts'
import { type Timings } from './timing.server.ts'

export const connectionSessionStorage = createCookieSessionStorage({
	cookie: {
		name: 'en_connection',
		sameSite: 'lax', // CSRF protection is advised if changing to 'none'
		path: '/',
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		secrets: process.env.SESSION_SECRET.split(','),
		secure: process.env.NODE_ENV === 'production',
	},
})

export const providers: Record<ProviderName, AuthProvider> = {
	// github: new GitHubProvider(),
  mal: new MALProvider(),
  trakt: new TraktProvider(),
}

export function handleMockAction(providerName: ProviderName, request: Request) {
	return providers[providerName].handleMockAction(request)
}

export function resolveConnectionData(
	providerName: ProviderName,
	providerId: string,
	options?: { timings?: Timings },
) {
	return providers[providerName].resolveConnectionData(providerId, options)
}
