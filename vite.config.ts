import { vitePlugin as remix } from '@remix-run/dev'
import { defineConfig } from 'vite'

const MODE = process.env.NODE_ENV

declare module '@remix-run/server-runtime' {
	interface Future {
		v3_singleFetch: true
	}
}

export default defineConfig({
	build: {
		cssMinify: MODE === 'production',

		rollupOptions: {
			external: [/node:.*/, 'stream', 'crypto', 'fsevents'],
		},

		assetsInlineLimit: (source: string) => {
			if (source.endsWith('sprite.svg')) {
				return false
			}
		},

		sourcemap: true,
	},
	server: {
		watch: {
			ignored: ['**/playwright-report/**'],
		},
	},
	plugins: [
		remix({
			future: {
				v3_fetcherPersist: true,
				v3_lazyRouteDiscovery: true,
				v3_relativeSplatPath: true,
				v3_routeConfig: true,
				v3_singleFetch: true,
				v3_throwAbortReason: true,
			},
			serverModuleFormat: 'esm',
		}),
	],
  ssr: {
    noExternal: [/^d3.*$/, /^@nivo.*$/],
  },
})
