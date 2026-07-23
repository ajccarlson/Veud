import crypto from 'crypto'
import { createRequestHandler } from '@react-router/express'
import * as Sentry from '@sentry/react-router'
import { ip as ipAddress } from 'address'
import chalk from 'chalk'
import closeWithGrace from 'close-with-grace'
import compression from 'compression'
import express, { type Request } from 'express'
import rateLimit from 'express-rate-limit'
import getPort, { portNumbers } from 'get-port'
import helmet from 'helmet'
import morgan from 'morgan'
import { RouterContextProvider, type ServerBuild } from 'react-router'
import {
	type cspNonceContext as CspNonceContext,
	type serverBuildContext as ServerBuildContext,
} from '../app/env.ts'
import { canonicalOriginFromEnvironment } from '../app/utils/canonical-origin.ts'
import { rateLimitClientKey } from '../app/utils/proxy-security.server.ts'

type ServerContextModule = {
	cspNonceContext: typeof CspNonceContext
	serverBuildContext: typeof ServerBuildContext
}

const MODE = process.env.NODE_ENV ?? 'development'

const viteDevServer =
	MODE === 'production'
		? undefined
		: await import('vite').then(vite =>
				vite.createServer({
					server: { middlewareMode: true },
				}),
			)

const app = express()

const getHost = (req: { get: (key: string) => string | undefined }) =>
	req.get('X-Forwarded-Host') ?? req.get('host') ?? ''

// cloudflared runs on this machine and proxies to the local origin, so the only proxy hop
// to trust is loopback. Trusting all proxies ('true') would let a client set
// X-Forwarded-For and thereby control req.ip.
app.set('trust proxy', 'loopback')

// ensure HTTPS only (X-Forwarded-Proto comes from Cloudflare Tunnel)
app.use((req, res, next) => {
	const proto = req.get('X-Forwarded-Proto')
	const host = getHost(req)
	if (proto === 'http') {
		const canonicalOrigin = canonicalOriginFromEnvironment()
		const destination = canonicalOrigin
			? `${canonicalOrigin}${req.originalUrl.startsWith('/') ? req.originalUrl : `/${req.originalUrl}`}`
			: `https://${host}${req.originalUrl}`
		res.set('X-Forwarded-Proto', 'https')
		res.redirect(308, destination)
		return
	}
	next()
})

// no ending slashes for SEO reasons
// https://github.com/epicweb-dev/epic-stack/discussions/108
app.get('*', (req, res, next) => {
	if (req.path.endsWith('/') && req.path.length > 1) {
		const query = req.url.slice(req.path.length)
		const safepath = req.path.slice(0, -1).replace(/\/+/g, '/')
		res.redirect(302, safepath + query)
	} else {
		next()
	}
})

app.use(compression())

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable('x-powered-by')

if (viteDevServer) {
	app.use(viteDevServer.middlewares)
} else {
	// Remix fingerprints its assets so we can cache forever.
	app.use(
		'/assets',
		express.static('build/client/assets', { immutable: true, maxAge: '1y' }),
	)

	// Everything else (like favicon.ico) is cached for an hour. You may want to be
	// more aggressive with this caching.
	app.use(express.static('build/client', { maxAge: '1h' }))
}

app.get(['/img/*', '/favicons/*'], (req, res) => {
	// if we made it past the express.static for these, then we're missing something.
	// So we'll just send a 404 and won't bother calling other middleware.
	return res.status(404).send('Not found')
})

morgan.token('url', req => {
	try {
		return decodeURIComponent(req.url ?? '')
	} catch {
		return req.url ?? ''
	}
})
app.use(
	morgan('tiny', {
		skip: (req, res) =>
			res.statusCode === 200 &&
			(req.url?.startsWith('/resources/note-images') ||
				req.url?.startsWith('/resources/user-images') ||
				req.url?.startsWith('/resources/healthcheck')),
	}),
)

app.use((_, res, next) => {
	res.locals.cspNonce = crypto.randomBytes(16).toString('hex')
	next()
})

app.use(
	helmet({
		referrerPolicy: { policy: 'same-origin' },
		crossOriginEmbedderPolicy: false,
		contentSecurityPolicy: {
			// CSP is now ENFORCED (not report-only). Two relaxations vs. the Epic Stack
			// default are needed by this app: `https:` in img-src (poster art is loaded
			// from TMDB/MAL/AniList image CDNs, including as CSS background images) and
			// `'unsafe-inline'` in style-src (the UI uses inline style={{...}} attributes
			// throughout). Set this back to true to return to non-blocking report mode.
			reportOnly: false,
			directives: {
				'connect-src': [
					MODE === 'development' ? 'ws:' : null,
					process.env.SENTRY_DSN ? '*.ingest.sentry.io' : null,
					"'self'",
				].filter(Boolean),
				'font-src': ["'self'"],
				'frame-src': ["'self'"],
				'img-src': ["'self'", 'data:', 'https:'],
				'style-src': ["'self'", "'unsafe-inline'"],
				'script-src': [
					"'strict-dynamic'",
					"'self'",
					// @ts-expect-error
					(_, res) => `'nonce-${res.locals.cspNonce}'`,
				],
				'script-src-attr': [
					// @ts-expect-error
					(_, res) => `'nonce-${res.locals.cspNonce}'`,
				],
				'upgrade-insecure-requests': null,
			},
		},
	}),
)

// When running tests or running in development, we want to effectively disable
// rate limiting because playwright tests are very fast and we don't want to
// have to wait for the rate limit to reset between tests.
const maxMultiple =
	MODE !== 'production' || process.env.PLAYWRIGHT_TEST_BASE_URL ? 10_000 : 1
const rateLimitDefault = {
	windowMs: 60 * 1000,
	max: 1000 * maxMultiple,
	standardHeaders: true,
	legacyHeaders: false,
	// Accept Cloudflare's client address only when the direct socket is the local
	// tunnel. A direct client can otherwise forge CF-Connecting-IP.
	keyGenerator: (req: Request) =>
		rateLimitClientKey({
			socketAddress: req.socket.remoteAddress,
			cloudflareAddress: req.get('cf-connecting-ip'),
			requestAddress: req.ip,
		}),
	// trust proxy is narrowed to loopback (above), so the prior Fly note no longer applies.
	validate: { trustProxy: false },
}

const strongestRateLimit = rateLimit({
	...rateLimitDefault,
	windowMs: 60 * 1000,
	max: 10 * maxMultiple,
})

const strongRateLimit = rateLimit({
	...rateLimitDefault,
	windowMs: 60 * 1000,
	max: 100 * maxMultiple,
})

const generalRateLimit = rateLimit(rateLimitDefault)
app.use((req, res, next) => {
	const strongPaths = [
		'/login',
		'/signup',
		'/verify',
		'/admin',
		'/onboarding',
		'/reset-password',
		'/settings/profile',
		'/resources/login',
		'/resources/verify',
	]
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		if (strongPaths.some(p => req.path.includes(p))) {
			return strongestRateLimit(req, res, next)
		}
		return strongRateLimit(req, res, next)
	}

	// the verify route is a special case because it's a GET route that
	// can have a token in the query string
	if (req.path.includes('/verify')) {
		return strongestRateLimit(req, res, next)
	}

	return generalRateLimit(req, res, next)
})

async function getBuild() {
	const build = viteDevServer
		? viteDevServer.ssrLoadModule('virtual:react-router/server-build')
		: // @ts-ignore this should exist before running the server
			// but it may not exist just yet.
			// eslint-disable-next-line import/no-unresolved
			await import('#build/server/index.js')
	// not sure how to make this happy 🤷‍♂️
	return build as unknown as ServerBuild
}

app.all(
	'*',
	createRequestHandler({
		getLoadContext: async (_, res) => {
			const buildPromise = getBuild()
			const build = await buildPromise
			const { cspNonceContext, serverBuildContext } = build.entry
				.module as typeof build.entry.module & ServerContextModule
			const context = new RouterContextProvider()
			context.set(cspNonceContext, res.locals.cspNonce)
			context.set(serverBuildContext, buildPromise)
			return context
		},
		mode: MODE,
		build: MODE === 'production' ? await getBuild() : getBuild,
	}),
)

Sentry.setupExpressErrorHandler(app)

const desiredPort = Number(process.env.PORT || 4021)
const desiredHost = process.env.HOST?.trim() || undefined
const portToUse = await getPort({
	port: portNumbers(desiredPort, desiredPort + 100),
})

const server = desiredHost
	? app.listen(portToUse, desiredHost, handleListening)
	: app.listen(portToUse, handleListening)

function handleListening() {
	const addy = server.address()
	const portUsed =
		desiredPort === portToUse
			? desiredPort
			: addy && typeof addy === 'object'
				? addy.port
				: 0

	if (portUsed !== desiredPort) {
		console.warn(
			chalk.yellow(
				`⚠️  Port ${desiredPort} is not available, using ${portUsed} instead.`,
			),
		)
	}
	console.log(`🚀  We have liftoff!`)
	if (desiredHost) console.log(`   Bound to ${desiredHost}:${portUsed}`)
	const localUrl = `http://localhost:${portUsed}`
	let lanUrl: string | null = null
	const localIp = ipAddress() ?? 'Unknown'
	// Check if the address is a private ip
	// https://en.wikipedia.org/wiki/Private_network#Private_IPv4_address_spaces
	// https://github.com/facebook/create-react-app/blob/d960b9e38c062584ff6cfb1a70e1512509a966e7/packages/react-dev-utils/WebpackDevServerUtils.js#LL48C9-L54C10
	if (/^10[.]|^172[.](1[6-9]|2[0-9]|3[0-1])[.]|^192[.]168[.]/.test(localIp)) {
		lanUrl = `http://${localIp}:${portUsed}`
	}

	console.log(
		`
${chalk.bold('Local:')}            ${chalk.cyan(localUrl)}
${lanUrl ? `${chalk.bold('On Your Network:')}  ${chalk.cyan(lanUrl)}` : ''}
${chalk.bold('Press Ctrl+C to stop')}
		`.trim(),
	)
}

closeWithGrace(async () => {
	await new Promise((resolve, reject) => {
		server.close(e => (e ? reject(e) : resolve('ok')))
	})
})
