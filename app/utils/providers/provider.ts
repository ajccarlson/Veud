import { type Strategy } from 'remix-auth/strategy'
import { type Timings } from '../timing.server.ts'

// Define a user type for cleaner typing
export type ProviderUser = {
	id: string
	email?: string
	username?: string
	name?: string
	imageUrl?: string
}

export function getOAuthCookie(providerName: string) {
	return {
		name: `en_oauth2_${providerName}`,
		httpOnly: true as const,
		maxAge: 60 * 10,
		path: '/',
		sameSite: 'Lax' as const,
		...(process.env.NODE_ENV === 'production' ? { secure: true as const } : {}),
	}
}

export interface AuthProvider {
	getAuthStrategy(): Strategy<ProviderUser, never>
	handleMockAction(request: Request): Promise<void>
	resolveConnectionData(
		providerId: string,
		options?: { timings?: Timings },
	): Promise<{
		displayName: string
		link?: string | null
	}>
}
