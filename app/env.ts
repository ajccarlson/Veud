import { type ServerBuild } from 'react-router'

declare module 'react-router' {
	interface AppLoadContext {
		cspNonce: string
		serverBuild: Promise<ServerBuild>
	}
}

export {}
