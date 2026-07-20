import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function titlesInOrder(watchlistId: string) {
	return prisma.entry
		.findMany({
			where: { watchlistId },
			orderBy: { position: 'asc' },
			select: { title: true, position: true },
		})
		.then(entries => entries.map(entry => `${entry.position}:${entry.title}`))
}

test('member can type a new position and see the persisted order', async ({
	page,
	login,
}) => {
	const user = await login()
	const listType = await prisma.listType.findUniqueOrThrow({
		where: { name: 'anime' },
	})
	const source = await prisma.watchlist.create({
		data: {
			name: 'watching',
			header: 'Watching',
			position: 1,
			displayedColumns: 'position, title, type',
			ownerId: user.id,
			typeId: listType.id,
		},
	})
	await Promise.all([
		prisma.entry.create({
			data: {
				watchlistId: source.id,
				position: 1,
				title: 'First reliability entry',
				type: 'TV Series',
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: source.id,
				position: 2,
				title: 'Moved reliability entry',
				type: 'TV Series',
			},
		}),
		prisma.entry.create({
			data: {
				watchlistId: source.id,
				position: 3,
				title: 'Third reliability entry',
				type: 'TV Series',
			},
		}),
	])

	await page.goto(`/lists/${user.username}/anime/${source.name}`)
	const firstPosition = page.getByLabel(
		'Move First reliability entry to position',
	)
	await firstPosition.fill('3')
	await firstPosition.press('Enter')
	await expect
		.poll(() => titlesInOrder(source.id))
		.toEqual([
			'1:Moved reliability entry',
			'2:Third reliability entry',
			'3:First reliability entry',
		])
	const renderedRows = page.locator('.ag-center-cols-container .ag-row')
	await expect(renderedRows.nth(0)).toContainText('Moved reliability entry')
	await expect(renderedRows.nth(1)).toContainText('Third reliability entry')
	await expect(renderedRows.nth(2)).toContainText('First reliability entry')
})
