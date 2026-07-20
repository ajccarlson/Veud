import { removePlaywrightDatabase } from './playwright-database.ts'

export default async function globalTeardown() {
	await removePlaywrightDatabase()
}
