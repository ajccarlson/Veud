#!/usr/bin/env node
/**
 * Refuse `npm start` when it would target the live production database.
 *
 * `npm start` runs the built server directly from the working tree with
 * whatever `.env` happens to contain. Against production that is blocked
 * anyway — the catalog-writer runtime guard requires a lifetime-lock launcher —
 * but the resulting failure is a guard stack trace that reads like a bug in the
 * application. Failing here instead says what to run.
 */
import { assertProductionDatabaseUrl } from './production-environment-utils.mjs'

function targetsLiveProduction(databaseUrl) {
	try {
		assertProductionDatabaseUrl(databaseUrl)
		return true
	} catch {
		return false
	}
}

if (targetsLiveProduction(process.env.DATABASE_URL ?? '')) {
	process.stderr.write(
		[
			'',
			'Refusing to run `npm start` against the live production database.',
			'',
			'Production must start through its lifetime-lock launcher so a single',
			'supervised writer holds the catalog lock:',
			'',
			'    npm run start:prod        # preflight, then PM2 with the launcher',
			'    pm2 save                  # persist so a reboot cannot resurrect a stale definition',
			'',
			'To run a production build locally instead, point DATABASE_URL at a',
			'non-production database first.',
			'',
		].join('\n'),
	)
	process.exit(1)
}
