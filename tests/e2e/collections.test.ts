import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('member can curate, reorder, and publish a media collection', async ({
	page,
	login,
}) => {
	const user = await login()
	const [first, second] = await Promise.all([
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Collection Browser Arrival',
				description: 'The first browser collection fixture.',
			},
		}),
		prisma.media.create({
			data: {
				kind: 'movie',
				title: 'Collection Browser Moon',
				description: 'The second browser collection fixture.',
			},
		}),
	])

	try {
		await page.goto('/collections/new')
		await page
			.getByLabel('Title', { exact: true })
			.fill('Browser Science Fiction Picks')
		await page
			.getByLabel('Description')
			.fill('A browser-tested collection of thoughtful science fiction.')
		await page.getByLabel('Tags').fill('browser tested, science fiction')
		await page.getByRole('button', { name: 'Create collection' }).click()
		await expect(page).not.toHaveURL(/\/collections\/new$/)
		await expect(page).toHaveURL(/\/collections\/[a-z0-9]+$/)
		const collectionId = page.url().split('/').pop()
		if (!collectionId)
			throw new Error('Collection redirect did not include an ID')

		await expect(
			page.getByRole('heading', { name: 'Add a title' }),
		).toBeVisible()
		const collectionPage = page.getByRole('main')
		await collectionPage
			.getByPlaceholder('Search media')
			.fill('Collection Browser Arrival')
		await collectionPage.getByRole('button', { name: 'Search' }).click()
		const arrivalResult = page
			.getByRole('article')
			.filter({ hasText: 'Collection Browser Arrival' })
		await arrivalResult.getByRole('button', { name: 'Add' }).click()
		await expect(page.getByRole('heading', { name: 'The list' })).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Collection Browser Arrival' }),
		).toBeVisible()
		await page.getByText('Add curator note', { exact: true }).click()
		await page
			.getByLabel('Why does this title belong here?')
			.fill('The emotional foundation of this ranking.')
		await page.getByRole('button', { name: 'Save note' }).click()
		await expect(
			page
				.getByRole('blockquote')
				.filter({ hasText: 'The emotional foundation of this ranking.' }),
		).toBeVisible()

		await page.goto(`/media/${second.id}`)
		await page
			.getByLabel('Collection')
			.selectOption({ label: 'Browser Science Fiction Picks' })
		await page.getByRole('button', { name: 'Add to collection' }).click()
		await expect(page.getByLabel('Collection')).toContainText(
			'✓ Browser Science Fiction Picks',
		)

		await page.goto(`/collections/${collectionId}`)
		await expect(
			page.getByRole('heading', { name: 'Collection Browser Arrival' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Collection Browser Moon' }),
		).toBeVisible()
		await expect(
			page
				.getByRole('blockquote')
				.filter({ hasText: 'The emotional foundation of this ranking.' }),
		).toBeVisible()
		await expect(page.getByText('#browser tested')).toBeVisible()
		await page.getByLabel('Move Collection Browser Moon up').click()
		await expect
			.poll(() =>
				prisma.mediaCollectionItem
					.findMany({
						where: { collectionId },
						orderBy: { position: 'asc' },
						select: { mediaId: true },
					})
					.then(items => items.map(item => item.mediaId)),
			)
			.toEqual([second.id, first.id])

		await page.goto(`/users/${user.username}/collections`)
		await expect(
			page.getByRole('heading', { name: 'Browser Science Fiction Picks' }),
		).toBeVisible()
		await page.goto('/collections?tag=browser-tested')
		await expect(
			page.getByRole('heading', { name: 'Browser Science Fiction Picks' }),
		).toBeVisible()
		await expect(page.getByText('tagged #browser tested')).toBeVisible()
		await page.goto('/collections?q=Browser+Science+Fiction')
		await expect(
			page.getByRole('heading', { name: 'Browser Science Fiction Picks' }),
		).toBeVisible()
	} finally {
		await prisma.media
			.deleteMany({ where: { id: { in: [first.id, second.id] } } })
			.catch(() => {})
	}
})

test('member can like, comment on, and clone a public collection', async ({
	page,
	login,
}) => {
	const user = await login()
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Collection Engagement Fixture' },
	})
	const source = await prisma.mediaCollection.create({
		data: {
			ownerId: user.id,
			title: 'Browser Engagement Picks',
			description: 'A collection ready for community engagement.',
			isPublic: true,
			items: { create: { mediaId: media.id, position: 1 } },
		},
	})

	try {
		await page.goto(`/collections/${source.id}`)
		await page.getByRole('button', { name: 'Like', exact: true }).click()
		await expect(
			page.getByRole('button', { name: 'Unlike', exact: true }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.collectionLike.count({ where: { collectionId: source.id } }),
			)
			.toBe(1)

		await page.getByLabel('Add a comment').fill('A browser-tested comment.')
		await page.getByRole('button', { name: 'Post comment' }).click()
		await expect(page.getByText('A browser-tested comment.')).toBeVisible()

		await page.getByRole('button', { name: 'Clone', exact: true }).click()
		await expect.poll(() => page.url().split('/').at(-1)).not.toBe(source.id)
		const cloneId = page.url().split('/').at(-1)
		if (!cloneId) throw new Error('Clone redirect did not include an ID')
		await expect(page.getByText('Private', { exact: true })).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Browser Engagement Picks (copy)' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Collection Engagement Fixture' }),
		).toBeVisible()

		const clone = await prisma.mediaCollection.findUniqueOrThrow({
			where: { id: cloneId },
			include: { items: true },
		})
		expect(clone).toMatchObject({ ownerId: user.id, isPublic: false })
		expect(clone.items.map(item => item.mediaId)).toEqual([media.id])
	} finally {
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})

test('admin can feature a public collection as a staff pick', async ({
	page,
	login,
}) => {
	const admin = await login()
	await prisma.role.upsert({
		where: { name: 'admin' },
		create: { name: 'admin', users: { connect: { id: admin.id } } },
		update: { users: { connect: { id: admin.id } } },
	})
	const collection = await prisma.mediaCollection.create({
		data: {
			ownerId: admin.id,
			title: 'Editorial Browser Pick',
			isPublic: true,
		},
	})

	await page.goto(`/collections/${collection.id}`)
	await page.getByRole('button', { name: 'Feature as staff pick' }).click()
	await expect(
		page.getByRole('button', { name: 'Remove staff pick' }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.mediaCollection
				.findUnique({
					where: { id: collection.id },
					select: { featuredAt: true },
				})
				.then(result => result?.featuredAt ?? null),
		)
		.not.toBeNull()

	await page.goto('/collections')
	await expect(page.getByRole('heading', { name: 'Staff picks' })).toBeVisible()
	await expect(page.getByText('Editorial Browser Pick').first()).toBeVisible()
})

test('member can browse collections personalized from followed curators', async ({
	page,
	login,
}) => {
	const viewer = await login()
	const owner = await prisma.user.create({
		data: {
			email: `collection_recommender_${viewer.id}@example.com`,
			username: `collection_recommender_${viewer.id}`,
		},
	})
	const media = await prisma.media.create({
		data: { kind: 'movie', title: 'Personalized Collection Fixture' },
	})
	await prisma.mediaCollection.create({
		data: {
			ownerId: owner.id,
			title: 'A Followed Curator Recommendation',
			isPublic: true,
			items: { create: { mediaId: media.id, position: 1 } },
		},
	})
	await prisma.follow.create({
		data: { followerId: viewer.id, followingId: owner.id },
	})

	try {
		await page.goto('/collections?sort=for-you')
		await expect(
			page.getByRole('heading', { name: 'Picked for you' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', {
				name: 'A Followed Curator Recommendation',
			}),
		).toBeVisible()
		await expect(
			page.getByText('Why this list: From someone you follow'),
		).toBeVisible()
		await expect(page.getByLabel('Sort by')).toHaveValue('for-you')
	} finally {
		await prisma.user.delete({ where: { id: owner.id } }).catch(() => {})
		await prisma.media.delete({ where: { id: media.id } }).catch(() => {})
	}
})
