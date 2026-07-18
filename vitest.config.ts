/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react()],
	css: { postcss: { plugins: [] } },
	test: {
		include: [
			'./app/**/*.test.{ts,tsx}',
			'./scripts/**/*.test.mjs',
		],
		setupFiles: ['./tests/setup/setup-test-env.ts'],
		globalSetup: ['./tests/setup/global-setup.ts'],
		restoreMocks: true,
		coverage: {
			include: ['app/**/*.{ts,tsx}'],
			// Coverage floor on the security-critical access-control helpers so that a
			// regression which drops their tests fails CI. These are conservative floors,
			// not targets: run `npm run coverage` to see real numbers, ratchet up, and add
			// a gate for the media proxy too (it's .jsx, outside this .ts/.tsx include).
			thresholds: {
				'**/authorization.server.ts': {
					statements: 70,
					branches: 40,
					functions: 80,
					lines: 70,
				},
			},
		},
	},
  resolve: {
    mainFields: ["module", "browser"],
  },
  ssr: {
    noExternal: [/^d3.*$/, /^@nivo.*$/],
  },
})
