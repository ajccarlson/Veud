const { execFileSync } = require('node:child_process')

function currentRelease() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
	} catch {
		return 'local'
	}
}

const release = currentRelease()
const productionLaunchers = process.env.NODE_ENV === 'production'

module.exports = {
	apps: [
		{
			name: 'veud',
			// Keep production signals in the application process. The prior npm
			// wrapper could forward duplicate signals and bypass graceful cleanup.
			script: productionLaunchers
				? 'ops/local-production/run-app.sh'
				: 'scripts/pm2-entry.mjs',
			interpreter: productionLaunchers ? 'bash' : 'node',
			instances: 1,
			exec_mode: 'fork',
			max_memory_restart: '300M',
			// Exceeds the application's 12-second graceful-shutdown deadline.
			kill_timeout: 15_000,

			// Logging
			out_file: './out.log',
			error_file: './error.log',
			merge_logs: true,
			log_date_format: 'DD-MM HH:mm:ss Z',
			log_type: 'json',

			// Env Specific Config
			env_production: {
				NODE_ENV: 'production',
				VEUD_ENVIRONMENT: 'production',
				VEUD_RELEASE: release,
				HOST: '127.0.0.1',
				PORT: '4021',
			},
			env_development: {
				NODE_ENV: 'development',
				MOCKS: 'true',
				watch: true,
				watch_delay: 3000,
				ignore_watch: [
					'./node_modules',
					'./app/views',
					'./public',
					'./.DS_Store',
					'./package.json',
					'./yarn.lock',
					'./samples',
					'./src',
				],
			},
		},
		{
			// Automatic provider-aware backups: SQLite online backup today, or a
			// pg_dump plus mandatory disposable-database restore after PostgreSQL cutover.
			// Fork-mode, non-restarting: it runs once when PM2 starts and then hourly via
			// cron_restart, so `npm run start:prod` gives you backups with no separate command or
			// crontab entry. The script no-ops under NODE_ENV=development, so `start:dev` does not
			// produce backups even though this ecosystem file is shared by both.
			name: 'veud-backup',
			script: productionLaunchers
				? 'ops/local-production/run-backup.sh'
				: 'scripts/backup-database.mjs',
			interpreter: productionLaunchers ? 'bash' : 'node',
			autorestart: false,
			cron_restart: '0 * * * *',

			env_production: {
				NODE_ENV: 'production',
			},
			env_development: {
				NODE_ENV: 'development',
			},
		},
	],
}
