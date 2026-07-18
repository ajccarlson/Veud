/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
<<<<<<< HEAD
import { defineConfig } from 'vite'
=======
import { defineConfig } from 'vitest/config'
>>>>>>> develop

export default defineConfig({
	plugins: [react()],
	css: { postcss: { plugins: [] } },
	test: {
<<<<<<< HEAD
		include: ['./app/**/*.test.{ts,tsx}'],
=======
		include: [
			'./app/**/*.test.{ts,tsx}',
			'./scripts/**/*.test.mjs',
		],
>>>>>>> develop
		setupFiles: ['./tests/setup/setup-test-env.ts'],
		globalSetup: ['./tests/setup/global-setup.ts'],
		restoreMocks: true,
		coverage: {
			include: ['app/**/*.{ts,tsx}'],
<<<<<<< HEAD
			all: true,
=======
>>>>>>> develop
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
