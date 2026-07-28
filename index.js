import 'dotenv/config'
import * as fs from 'fs'
import chalk from 'chalk'
import sourceMapSupport from 'source-map-support'

sourceMapSupport.install({
	retrieveSourceMap: function (source) {
		// get source file without the `file://` prefix or `?t=...` suffix
		const match = source.match(/^file:\/\/(.*)\?t=[.\d]+$/)
		if (match) {
			return {
				url: source,
				map: fs.readFileSync(`${match[1]}.map`, 'utf8'),
			}
		}
		return null
	},
})

let closeMockServer
let activateApplicationShutdown

try {
	const { init } = await import('./app/utils/env.server.ts')
	init()

	const shutdownModule =
		process.env.NODE_ENV === 'production'
			? await import('./server-build/shutdown.js')
			: await import('./server/shutdown.ts')
	const deferredShutdown = shutdownModule.createDeferredApplicationShutdown()
	activateApplicationShutdown = deferredShutdown.activate
	shutdownModule.installApplicationShutdownHandler(deferredShutdown.shutdown)
	await import('./instrument.server.mjs')

	if (process.env.MOCKS === 'true') {
		const mocks = await import('./tests/mocks/index.ts')
		closeMockServer = mocks.closeMockServer
	}

	const application =
		process.env.NODE_ENV === 'production'
			? await import('./server-build/index.js')
			: await import('./server/index.ts')
	activateApplicationShutdown(
		application.createServerShutdown({
			closeMocks: closeMockServer,
		}),
	)
} catch (error) {
	const closeStartupResources = async () => {
		closeMockServer?.()
	}
	activateApplicationShutdown?.(closeStartupResources)
	try {
		await closeStartupResources()
	} catch (mockCloseError) {
		console.error(chalk.red(String(mockCloseError)))
	}
	const message =
		error instanceof Error ? (error.stack ?? error.message) : String(error)
	console.error(chalk.red(message))
	throw error
}
