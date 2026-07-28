import { createContext, type ServerBuild } from 'react-router'

export const cspNonceContext = createContext<string>()
export const serverBuildContext = createContext<Promise<ServerBuild>>()
export const clientAddressContext = createContext<string>()
