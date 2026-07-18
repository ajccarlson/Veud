import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite'

const MODE = process.env.NODE_ENV

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
	plugins: [reactRouter()],
	ssr: {
		noExternal: [/^d3.*$/, /^@nivo.*$/],
	},
})
