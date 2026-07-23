import 'dotenv/config'
import { prisma } from '#app/utils/db.server.ts'
import { processDueNotificationDigests } from '#app/utils/notification-digests.server.ts'

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const limitIndex = args.indexOf('--limit')
const limit =
	limitIndex >= 0 ? Number.parseInt(args[limitIndex + 1] ?? '', 10) : 50
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
	throw new Error('--limit must be an integer from 1 through 500')
}
const known = new Set(['--commit', '--limit'])
for (let index = 0; index < args.length; index++) {
	const argument = args[index]!
	if (!known.has(argument)) throw new Error(`Unknown argument: ${argument}`)
	if (argument === '--limit') index++
}

const outcomes = await processDueNotificationDigests({ commit, limit })
const counts = outcomes.reduce<Record<string, number>>((summary, outcome) => {
	summary[outcome.status] = (summary[outcome.status] ?? 0) + 1
	return summary
}, {})
console.log(
	JSON.stringify(
		{
			mode: commit ? 'commit' : 'preview',
			due: outcomes.length,
			statuses: counts,
			items: outcomes.reduce((sum, outcome) => sum + outcome.itemCount, 0),
		},
		null,
		2,
	),
)
await prisma.$disconnect()
