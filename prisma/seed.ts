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
	console.time(`🌱 Database has been seeded`)

	console.time('🧹 Cleaned up the database...')
	await cleanupDb(prisma)
	console.timeEnd('🧹 Cleaned up the database...')

	console.time('🔑 Created permissions...')
	const entities = ['user', 'watchlist']
	const actions = ['create', 'read', 'update', 'delete']
	const accesses = ['own', 'any'] as const
	for (const entity of entities) {
		for (const action of actions) {
			for (const access of accesses) {
				await prisma.permission.create({ data: { entity, action, access } })
			}
		}
	}
	console.timeEnd('🔑 Created permissions...')

	console.time('👑 Created roles...')
	await prisma.role.create({
		data: {
			name: 'admin',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: { access: 'any' },
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
					where: { access: 'own' },
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
  listTypes.forEach(async (listType) => {
    await prisma.listType.create({
      data: listType,
    })
  })
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
