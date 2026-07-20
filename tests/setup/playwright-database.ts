import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { execa } from 'execa'
import fsExtra from 'fs-extra'

const BASE_DATABASE_PATH = path.join(process.cwd(), 'tests/prisma/base.db')
export const PLAYWRIGHT_DATABASE_PATH = path.join(
	process.cwd(),
	'tests/prisma/playwright.db',
)
export const PLAYWRIGHT_DATABASE_URL = `file:${PLAYWRIGHT_DATABASE_PATH}?connection_limit=1`

export async function preparePlaywrightDatabase() {
	await fsExtra.ensureDir(path.dirname(PLAYWRIGHT_DATABASE_PATH))
	await fsExtra.remove(PLAYWRIGHT_DATABASE_PATH)
	await execa('npx', ['prisma', 'migrate', 'deploy'], {
		stdio: 'inherit',
		env: { ...process.env, DATABASE_URL: `file:${BASE_DATABASE_PATH}` },
	})
	await fsExtra.copyFile(BASE_DATABASE_PATH, PLAYWRIGHT_DATABASE_PATH)

	const prisma = new PrismaClient({ datasourceUrl: PLAYWRIGHT_DATABASE_URL })
	try {
		const permissions = []
		for (const entity of ['user', 'watchlist']) {
			for (const action of ['create', 'read', 'update', 'delete']) {
				permissions.push(
					await prisma.permission.upsert({
						where: {
							action_entity_access: { entity, action, access: 'own' },
						},
						create: { entity, action, access: 'own' },
						update: {},
						select: { id: true },
					}),
				)
			}
		}
		await prisma.role.upsert({
			where: { name: 'user' },
			create: { name: 'user', permissions: { connect: permissions } },
			update: { permissions: { set: permissions } },
		})

		const listTypeCount = await prisma.listType.count()
		if (listTypeCount !== 3) {
			throw new Error(
				`Expected 3 migrated list types in the Playwright database; found ${listTypeCount}`,
			)
		}
	} finally {
		await prisma.$disconnect()
	}
}

export async function removePlaywrightDatabase() {
	await fsExtra.remove(PLAYWRIGHT_DATABASE_PATH)
	await fsExtra.remove(`${PLAYWRIGHT_DATABASE_PATH}-journal`)
	await fsExtra.remove(`${PLAYWRIGHT_DATABASE_PATH}-wal`)
	await fsExtra.remove(`${PLAYWRIGHT_DATABASE_PATH}-shm`)
}
