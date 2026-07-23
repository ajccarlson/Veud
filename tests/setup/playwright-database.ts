import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { execa } from 'execa'
import fsExtra from 'fs-extra'

export const DEVELOPMENT_DATABASE_PATH = path.join(
	process.cwd(),
	'prisma/data.db',
)
export const PLAYWRIGHT_DATABASE_PATH = path.join(
	process.cwd(),
	'tests/prisma/playwright.db',
)
const PLAYWRIGHT_MIGRATION_DATABASE_URL = `file:${PLAYWRIGHT_DATABASE_PATH}`
export const PLAYWRIGHT_DATABASE_URL = `file:${PLAYWRIGHT_DATABASE_PATH}?connection_limit=1`
const DEVELOPMENT_DATABASE_GUARD_PATH = path.join(
	process.cwd(),
	'tests/prisma/playwright-development-database.json',
)

type DatabaseFingerprint =
	{ exists: false } | { exists: true; bytes: number; sha256: string }

export function assertIsolatedDatabasePath(
	testDatabasePath: string,
	developmentDatabasePath = DEVELOPMENT_DATABASE_PATH,
) {
	const resolvedTestPath = path.resolve(testDatabasePath)
	const resolvedDevelopmentPath = path.resolve(developmentDatabasePath)
	const testDatabaseDirectory = `${path.resolve(
		process.cwd(),
		'tests/prisma',
	)}${path.sep}`
	if (resolvedTestPath === resolvedDevelopmentPath) {
		throw new Error('Playwright cannot use the development database')
	}
	if (!resolvedTestPath.startsWith(testDatabaseDirectory)) {
		throw new Error('Playwright database must stay inside tests/prisma')
	}
}

async function fingerprintDatabase(
	databasePath: string,
): Promise<DatabaseFingerprint> {
	try {
		const contents = await readFile(databasePath)
		return {
			exists: true,
			bytes: contents.byteLength,
			sha256: createHash('sha256').update(contents).digest('hex'),
		}
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return { exists: false }
		}
		throw error
	}
}

async function removePlaywrightDatabaseFiles() {
	await fsExtra.remove(PLAYWRIGHT_DATABASE_PATH)
	await fsExtra.remove(`${PLAYWRIGHT_DATABASE_PATH}-journal`)
	await fsExtra.remove(`${PLAYWRIGHT_DATABASE_PATH}-wal`)
	await fsExtra.remove(`${PLAYWRIGHT_DATABASE_PATH}-shm`)
}

async function captureDevelopmentDatabaseGuard() {
	await fsExtra.writeJson(DEVELOPMENT_DATABASE_GUARD_PATH, {
		path: DEVELOPMENT_DATABASE_PATH,
		fingerprint: await fingerprintDatabase(DEVELOPMENT_DATABASE_PATH),
	})
}

async function verifyDevelopmentDatabaseGuard() {
	if (!(await fsExtra.pathExists(DEVELOPMENT_DATABASE_GUARD_PATH))) return
	const guard = (await fsExtra.readJson(DEVELOPMENT_DATABASE_GUARD_PATH)) as {
		path: string
		fingerprint: DatabaseFingerprint
	}
	const current = await fingerprintDatabase(guard.path)
	if (JSON.stringify(current) !== JSON.stringify(guard.fingerprint)) {
		throw new Error(
			'Playwright run changed prisma/data.db; browser tests must use only their disposable database',
		)
	}
}

export async function preparePlaywrightDatabase() {
	assertIsolatedDatabasePath(PLAYWRIGHT_DATABASE_PATH)
	await fsExtra.ensureDir(path.dirname(PLAYWRIGHT_DATABASE_PATH))
	await removePlaywrightDatabaseFiles()
	// Prisma 5's SQLite schema engine requires the target file to exist before
	// `migrate deploy`, even though the database is otherwise created from scratch.
	await fsExtra.ensureFile(PLAYWRIGHT_DATABASE_PATH)
	await fsExtra.remove(DEVELOPMENT_DATABASE_GUARD_PATH)
	await captureDevelopmentDatabaseGuard()
	try {
		await execa('npx', ['prisma', 'migrate', 'deploy'], {
			stdio: 'inherit',
			env: { ...process.env, DATABASE_URL: PLAYWRIGHT_MIGRATION_DATABASE_URL },
		})

		const prisma = new PrismaClient({ datasourceUrl: PLAYWRIGHT_DATABASE_URL })
		try {
			const [
				listTypeCount,
				userCount,
				watchlistCount,
				entryCount,
				mediaCount,
				roles,
				permissionCount,
			] = await Promise.all([
				prisma.listType.count(),
				prisma.user.count(),
				prisma.watchlist.count(),
				prisma.entry.count(),
				prisma.media.count(),
				prisma.role.findMany({
					where: { name: { in: ['admin', 'user'] } },
					select: {
						name: true,
						permissions: {
							where: {
								entity: { in: ['user', 'watchlist'] },
								action: { in: ['create', 'read', 'update', 'delete'] },
								access: { in: ['own', 'any'] },
							},
							select: { access: true },
						},
					},
				}),
				prisma.permission.count(),
			])
			if (listTypeCount !== 3) {
				throw new Error(
					`Expected 3 migrated list types in the Playwright database; found ${listTypeCount}`,
				)
			}
			const rolePermissions = new Map(
				roles.map(role => [
					role.name,
					role.permissions.map(permission => permission.access),
				]),
			)
			const userPermissions = rolePermissions.get('user')
			const adminPermissions = rolePermissions.get('admin')
			if (
				permissionCount !== 16 ||
				userPermissions?.length !== 8 ||
				!userPermissions.every(access => access === 'own') ||
				adminPermissions?.length !== 8 ||
				!adminPermissions.every(access => access === 'any')
			) {
				throw new Error(
					'Playwright database migrations must install authorization reference data',
				)
			}
			if (userCount || watchlistCount || entryCount || mediaCount) {
				throw new Error(
					'Playwright database must start without users, lists, entries, or catalog fixtures',
				)
			}
		} finally {
			await prisma.$disconnect()
		}
	} catch (error) {
		await removePlaywrightDatabase()
		throw error
	}
}

export async function removePlaywrightDatabase() {
	try {
		await verifyDevelopmentDatabaseGuard()
	} finally {
		await removePlaywrightDatabaseFiles()
		await fsExtra.remove(DEVELOPMENT_DATABASE_GUARD_PATH)
	}
}
