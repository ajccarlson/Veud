import path from 'node:path'
import { execaCommand } from 'execa'
import fsExtra from 'fs-extra'

export const BASE_DATABASE_PATH = path.join(
	process.cwd(),
	`./tests/prisma/base.db`,
)

export async function setup() {
	await fsExtra.ensureDir(path.dirname(BASE_DATABASE_PATH))

	// Keep the reusable template current when a migration is added after it was
	// first created. Test workers clone this file, so a stale template otherwise
	// fails with missing-column errors until every developer deletes it manually.
	await execaCommand('prisma migrate deploy', {
		stdio: 'inherit',
		env: {
			...process.env,
			DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
		},
	})
}
