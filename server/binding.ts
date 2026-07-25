export type ServerBindingEnvironment = {
	NODE_ENV?: string
	PORT?: string
	HOST?: string
}

export function resolveServerBinding(environment: ServerBindingEnvironment) {
	const production = environment.NODE_ENV === 'production'
	const parsedPort = Number(environment.PORT?.trim() || 4021)
	if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
		throw new Error('PORT must be an integer between 1 and 65535.')
	}

	return {
		host: environment.HOST?.trim() || (production ? '127.0.0.1' : undefined),
		port: parsedPort,
		allowPortFallback: !production,
	}
}
