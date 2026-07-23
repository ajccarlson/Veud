import { faker } from '@faker-js/faker'
import { prisma } from '#app/utils/db.server.ts'
import {
	cleanupDb,
	createPassword,
	createUser,
	getUserImages,
	randomWatchlists,
} from '#tests/db-utils.ts'

async function seed() {
	console.log('🌱 Seeding...')

	// Safety guard: `prisma db seed` (also run by `npm run setup` and by
	// `prisma migrate reset`) deletes ALL data via cleanupDb() below. Refuse to run
	// against a database that already holds data unless explicitly forced, so a
	// populated/production database can't be wiped by accident.
	let existingUserCount = 0
	try {
		existingUserCount = await prisma.user.count()
	} catch {
		// User table doesn't exist yet (brand-new database) — nothing to protect.
		existingUserCount = 0
	}
	if (existingUserCount > 0 && process.env.ALLOW_SEED_WIPE !== 'true') {
		throw new Error(
			`Refusing to seed: the database already has ${existingUserCount} user(s), and ` +
				`seeding deletes everything. To intentionally wipe and re-seed, re-run with ` +
				`ALLOW_SEED_WIPE=true (e.g. "ALLOW_SEED_WIPE=true npx prisma db seed").`,
		)
	}

	console.time(`🌱 Database has been seeded`)

	console.time('🧹 Cleaned up the database...')
	await cleanupDb(prisma)
	console.timeEnd('🧹 Cleaned up the database...')

	console.time('🔑 Created permissions...')
	const entities = ['user', 'watchlist'] as const
	const actions = ['create', 'read', 'update', 'delete'] as const
	const accesses = ['own', 'any'] as const
	for (const entity of entities) {
		for (const action of actions) {
			for (const access of accesses) {
				await prisma.permission.create({ data: { entity, action, access } })
			}
		}
	}
	const moderationPermissions = [
		{
			action: 'create',
			entity: 'report',
			access: 'own',
			description: 'Submit community safety reports',
		},
		{
			action: 'read',
			entity: 'report',
			access: 'any',
			description: 'Review the moderation queue',
		},
		{
			action: 'update',
			entity: 'report',
			access: 'any',
			description: 'Assign and resolve moderation reports',
		},
		{
			action: 'moderate',
			entity: 'content',
			access: 'any',
			description: 'Hide and restore community content',
		},
		{
			action: 'moderate',
			entity: 'user',
			access: 'any',
			description: 'Warn, suspend, and restore member accounts',
		},
		{
			action: 'assign',
			entity: 'role',
			access: 'any',
			description: 'Grant and revoke moderator access',
		},
		{
			action: 'read',
			entity: 'operations',
			access: 'any',
			description: 'View private site operations telemetry',
		},
		{
			action: 'update',
			entity: 'operations',
			access: 'any',
			description: 'Publish and update public service incidents',
		},
	] as const
	await prisma.permission.createMany({ data: [...moderationPermissions] })
	console.timeEnd('🔑 Created permissions...')

	console.time('👑 Created roles...')
	await prisma.role.create({
		data: {
			name: 'admin',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: {
						OR: [
							{ access: 'any' },
							{ action: 'create', entity: 'report', access: 'own' },
						],
					},
				}),
			},
		},
	})
	await prisma.role.create({
		data: {
			name: 'user',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: {
						OR: [
							{
								entity: { in: ['user', 'watchlist'] },
								access: 'own',
							},
							{ action: 'create', entity: 'report', access: 'own' },
						],
					},
				}),
			},
		},
	})
	await prisma.role.create({
		data: {
			name: 'moderator',
			description: 'Community safety moderator',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: {
						OR: [
							{ action: 'create', entity: 'report', access: 'own' },
							{ action: 'read', entity: 'report', access: 'any' },
							{ action: 'update', entity: 'report', access: 'any' },
							{ action: 'moderate', entity: 'content', access: 'any' },
							{ action: 'moderate', entity: 'user', access: 'any' },
						],
					},
				}),
			},
		},
	})
	await prisma.role.create({
		data: {
			name: 'community-admin',
			description: 'Moderation team administrator',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: {
						OR: [
							{ action: 'create', entity: 'report', access: 'own' },
							{ action: 'read', entity: 'report', access: 'any' },
							{ action: 'update', entity: 'report', access: 'any' },
							{ action: 'moderate', entity: 'content', access: 'any' },
							{ action: 'moderate', entity: 'user', access: 'any' },
							{ action: 'assign', entity: 'role', access: 'any' },
						],
					},
				}),
			},
		},
	})
	await prisma.role.create({
		data: {
			name: 'site-operator',
			description: 'Site reliability and incident operator',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: { entity: 'operations', access: 'any' },
				}),
			},
		},
	})
	console.timeEnd('👑 Created roles...')

	const listTypes = [
		{
			id: `yducsgix`,
      name: `liveaction`,
      header: `Live Action`,
      columns: `{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","airYear":"string","releaseStart":"date","releaseEnd":"date","length":"string","rating":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","language":"string","story":"number","character":"number","presentation":"number","sound":"number","performance":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","tmdbScore":"number","differenceObjective":"number","description":"string","notes":"string"}`,
      mediaType: `["episode"]`,
      completionType: `{"present":"watch","past":"watched","continuous":"watching"}`
		},
    {
			id: `lx727mrc`,
      name: `anime`,
      header: `Anime`,
      columns: `{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","startSeason":"string","releaseStart":"date","releaseEnd":"date","length":"string","rating":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","studios":"string","priority":"string","story":"number","character":"number","presentation":"number","sound":"number","performance":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","malScore":"number","differenceObjective":"number","description":"string","notes":"string"}`,
      mediaType: `["episode"]`,
      completionType: `{"present":"watch","past":"watched","continuous":"watching"}`
		},
    {
			id: `b44evg7f`,
      name: `manga`,
      header: `Manga`,
      columns: `{"id":"string","watchlistId":"string","position":"number","thumbnail":"string","title":"string","type":"string","startYear":"string","releaseStart":"date","releaseEnd":"date","chapters":"string","volumes":"string","startDate":"history", "finishedDate":"history", "dateAdded":"history", "lastUpdated":"history","genres":"string","serialization":"string","authors":"string","priority":"string","story":"number","character":"number","presentation":"number","enjoyment":"number","averaged":"number","personal":"number","differencePersonal":"number","malScore":"number","differenceObjective":"number","description":"string","notes":"string"}`,
      mediaType: `["chapter","volume"]`,
      completionType: `{"present":"read","past":"read","continuous":"reading"}`
		},
	]

	console.time('Created list types...')
	for (const listType of listTypes) {
		await prisma.listType.create({ data: listType })
	}
	console.timeEnd('Created list types...')

	const totalUsers = 5
	console.time(`👤 Created ${totalUsers} users...`)
	const userImages = await getUserImages()

	for (let index = 0; index < totalUsers; index++) {
		const userData = createUser()
		const userId = faker.string.uuid()

		await prisma.user
			.create({
				select: { id: true },
				data: {
					id: userId,
					...userData,
					password: { create: createPassword(userData.username) },
					image: { create: userImages[index % userImages.length] },
					roles: { connect: { name: 'user' } },
				},
			})
			.catch(e => {
				console.error('Error creating a user:', e)
				return null
			})

		await randomWatchlists(listTypes, userId, false)
	}
	console.timeEnd(`👤 Created ${totalUsers} users...`)

	console.timeEnd(`🌱 Database has been seeded`)
}

seed()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
