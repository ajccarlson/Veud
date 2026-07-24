import { defineConfig, devices } from '@playwright/test'
import 'dotenv/config'
import { PLAYWRIGHT_DATABASE_URL } from './tests/setup/playwright-database.ts'

const PORT = process.env.PORT || '4022'
const BASE_URL = `http://localhost:${PORT}`
process.env.DATABASE_URL = PLAYWRIGHT_DATABASE_URL

export default defineConfig({
	testDir: './tests/e2e',
	globalTeardown: './tests/setup/playwright-global-teardown.ts',
	timeout: 15 * 1000,
	expect: {
		timeout: 15 * 1000,
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// The browser and application share one disposable SQLite database. Keeping
	// one worker makes writes deterministic without ever touching development data.
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: `${BASE_URL}/`,
		trace: 'on-first-retry',
	},

	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
			},
		},
	],

	webServer: {
		command: 'npm run test:e2e:server',
		port: Number(PORT),
		reuseExistingServer: false,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			PORT,
			DATABASE_URL: PLAYWRIGHT_DATABASE_URL,
			VEUD_E2E: '1',
			// Production-mode browser tests must generate verification links that
			// point back to their isolated local origin, never the real site.
			VEUD_ORIGIN: BASE_URL,
		},
	},
})
