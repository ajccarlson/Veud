import fs from 'node:fs'
import { faker } from '@faker-js/faker'
import { type PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { UniqueEnforcer } from 'enforce-unique'
import { getTopEntries } from "#app/routes/media+/mal.jsx"
import { getTMDBTrending } from "#app/routes/media+/tmdb.jsx"

const uniqueUsernameEnforcer = new UniqueEnforcer()

export function createUser() {
	const firstName = faker.person.firstName()
	const lastName = faker.person.lastName()

	const username = uniqueUsernameEnforcer
		.enforce(() => {
			return (
				faker.string.alphanumeric({ length: 2 }) +
				'_' +
				faker.internet.userName({
					firstName: firstName.toLowerCase(),
					lastName: lastName.toLowerCase(),
				})
			)
		})
		.slice(0, 20)
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, '_')
	return {
		username,
		name: `${firstName} ${lastName}`,
		email: `${username}@example.com`,
	}
}

export function createPassword(password: string = faker.internet.password()) {
	return {
		hash: bcrypt.hashSync(password, 10),
	}
}

let noteImages: Array<Awaited<ReturnType<typeof img>>> | undefined
export async function getNoteImages() {
	if (noteImages) return noteImages

	noteImages = await Promise.all([
		img({
			altText: 'a nice country house',
			filepath: './tests/fixtures/images/notes/0.png',
		}),
		img({
			altText: 'a city scape',
			filepath: './tests/fixtures/images/notes/1.png',
		}),
		img({
			altText: 'a sunrise',
			filepath: './tests/fixtures/images/notes/2.png',
		}),
		img({
			altText: 'a group of friends',
			filepath: './tests/fixtures/images/notes/3.png',
		}),
		img({
			altText: 'friends being inclusive of someone who looks lonely',
			filepath: './tests/fixtures/images/notes/4.png',
		}),
		img({
			altText: 'an illustration of a hot air balloon',
			filepath: './tests/fixtures/images/notes/5.png',
		}),
		img({
			altText:
				'an office full of laptops and other office equipment that look like it was abandoned in a rush out of the building in an emergency years ago.',
			filepath: './tests/fixtures/images/notes/6.png',
		}),
		img({
			altText: 'a rusty lock',
			filepath: './tests/fixtures/images/notes/7.png',
		}),
		img({
			altText: 'something very happy in nature',
			filepath: './tests/fixtures/images/notes/8.png',
		}),
		img({
			altText: `someone at the end of a cry session who's starting to feel a little better.`,
			filepath: './tests/fixtures/images/notes/9.png',
		}),
	])

	return noteImages
}

let userImages: Array<Awaited<ReturnType<typeof img>>> | undefined
export async function getUserImages() {
	if (userImages) return userImages

	userImages = await Promise.all(
		Array.from({ length: 10 }, (_, index) =>
			img({ filepath: `./tests/fixtures/images/user/${index}.jpg` }),
		),
	)

	return userImages
}

export async function img({
	altText,
	filepath,
}: {
	altText?: string
	filepath: string
}) {
	return {
		altText,
		contentType: filepath.endsWith('.png') ? 'image/png' : 'image/jpeg',
		blob: await fs.promises.readFile(filepath),
	}
}

export async function cleanupDb(prisma: PrismaClient) {
	const tables = await prisma.$queryRaw<
		{ name: string }[]
	>`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations';`

	await prisma.$transaction([
		// Disable FK constraints to avoid relation conflicts during deletion
		prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`),
		// Delete all rows from each table, preserving table structures
		...tables.map(({ name }) =>
			prisma.$executeRawUnsafe(`DELETE from "${name}"`),
		),
		prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`),
	])
}

export async function randomWatchlists(listTypes: any[]) {
  let watchlists = []
  let typeCounts = {
    liveActionCount: 1,
    animeCount: 1,
    mangaCount: 1,
  }

  for (let i = 0; i < faker.number.int({ min: 1, max: 7 }); i++) {
    const chosenType = listTypes[Math.floor(Math.random() * listTypes.length)]
    const listName = faker.lorem.sentence()
    const formattedHeader = `${chosenType.header.charAt(0).toLowerCase()}${chosenType.header.slice(1).replace(/\W/g, '')}`
    const watchlistId = faker.string.uuid()

    let listEntries: any[] = []

    let resultInfo: any
    if (chosenType.name == "liveaction") {
      resultInfo = await getTMDBTrending("all", 50)
    }
    else if (chosenType.name == "anime") {
      resultInfo = await getTopEntries("anime", "bypopularity", 50)
    }
    else if (chosenType.name == "manga") {
      resultInfo = await getTopEntries("manga", "bypopularity", 50)
    }

    for(let j = 0; j < faker.number.int({ min: 1, max: 20 }); j++) {
      let addRow
      if (chosenType.name == "liveaction") {
        addRow = {/*id: " ", */watchlistId: watchlistId, position: j + 1, thumbnail: resultInfo?.thumbnail, title: resultInfo?.title, type: resultInfo?.type, airYear: String(resultInfo?.year), releaseStart: new Date(resultInfo?.releaseStart), releaseEnd: new Date(resultInfo?.releaseEnd), nextRelease:  JSON.stringify(resultInfo?.nextRelease), length: resultInfo?.length, rating: resultInfo?.rating, history: JSON.stringify({added: Date.now(), started: null, finished: null, progress: null, lastUpdated: Date.now(), }), genres: resultInfo?.genres , language: resultInfo?.language, story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, tmdbScore: resultInfo?.score, differenceObjective: 0, description: resultInfo?.description, notes: ""}
      }
      else if (chosenType.name == "anime") {
        addRow = {/*id: " ", */watchlistId: watchlistId, position: j + 1, thumbnail: resultInfo?.thumbnail, title: resultInfo?.title, type: resultInfo?.type, startSeason: resultInfo?.startSeason.name, releaseStart: new Date(resultInfo?.releaseStart), releaseEnd: new Date(resultInfo?.releaseEnd), nextRelease:  JSON.stringify(resultInfo?.nextRelease), length: resultInfo?.length, rating: resultInfo?.rating, history: JSON.stringify({added: Date.now(), started: null, finished: null, progress: null, lastUpdated: Date.now(), }), genres: resultInfo?.genres , studios: JSON.stringify(resultInfo?.studios), priority: "Low", story: 0, character: 0, presentation: 0, sound: 0, performance: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, malScore: resultInfo?.malScore, differenceObjective: 0, description: resultInfo?.description, notes: ""}
      }
      else if (chosenType.name == "manga") {
        addRow = {/*id: " ", */watchlistId: watchlistId, position: j + 1, thumbnail: resultInfo?.thumbnail, title: resultInfo?.title, type: resultInfo?.type, startYear: String(resultInfo?.startYear), releaseStart: new Date(resultInfo?.releaseStart), releaseEnd: new Date(resultInfo?.releaseEnd), nextRelease:  JSON.stringify(resultInfo?.nextRelease), chapters: String(resultInfo?.chapters), volumes: String(resultInfo?.volumes), history: JSON.stringify({added: Date.now(), started: null, finished: null, progress: null, lastUpdated: Date.now(), }), genres: resultInfo?.genres , serialization: JSON.stringify(resultInfo?.serialization), authors: JSON.stringify(resultInfo?.authors), priority: "Low", story: 0, character: 0, presentation: 0, enjoyment: 0, averaged: 0, personal: 0, differencePersonal: 0, malScore: resultInfo?.malScore, differenceObjective: 0, description: resultInfo?.description, notes: ""}
      } 

      listEntries.push(addRow)
    }

    watchlists.push({
      id: watchlistId,
      position: typeCounts[`${formattedHeader}Count` as keyof typeof typeCounts],
      name: listName,
      header: listName.replace(/\W/g, '').toLowerCase(),
      typeId: chosenType.id,
      displayedColumns: chosenType.columns,
      description: faker.lorem.paragraphs(),
      [`${formattedHeader}Entries`]: listEntries
    })

    typeCounts[`${formattedHeader}Count` as keyof typeof typeCounts]++
  }

  return watchlists
}
