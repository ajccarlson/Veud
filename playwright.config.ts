import { defineConfig, devices } from '@playwright/test'
import 'dotenv/config'
import { PLAYWRIGHT_DATABASE_URL } from './tests/setup/playwright-database.ts'

const PORT = process.env.PORT || '4022'
const BASE_URL = `http://localhost:${PORT}`
const E2E_SESSION_SECRET =
	'playwright-session-secret-is-isolated-and-nonproduction'
const E2E_HONEYPOT_SECRET =
	'playwright-honeypot-secret-is-isolated-and-nonproduction'
process.env.DATABASE_URL = PLAYWRIGHT_DATABASE_URL
process.env.SESSION_SECRET = E2E_SESSION_SECRET
process.env.VERIFICATION_SECRET_KEYS = ''
process.env.INTERNAL_COMMAND_TOKEN = ''
process.env.HONEYPOT_SECRET = E2E_HONEYPOT_SECRET

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
			// Browser tests exercise AI-enabled UI without using a developer's
			// billable credential or making provider calls.
			OPENAI_API_KEY: 'test-key',
			SESSION_SECRET: E2E_SESSION_SECRET,
			VERIFICATION_SECRET_KEYS: '',
			INTERNAL_COMMAND_TOKEN: '',
			HONEYPOT_SECRET: E2E_HONEYPOT_SECRET,
			VEUD_E2E: '1',
			// The server runs in production mode, so this marker is what relaxes
			// rate limits enough for a full browser suite from one address.
			PLAYWRIGHT_TEST_BASE_URL: BASE_URL,
			// Production-mode browser tests must generate verification links that
			// point back to their isolated local origin, never the real site.
			VEUD_ORIGIN: BASE_URL,
		},
	},
})
