import { faker } from '@faker-js/faker'
import { expect, test } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'

/**
 * What the people tables promise, tested against the database rather than
 * against a description of it.
 *
 * Credits are rewritten on every catalog refresh, and a person is shared by
 * every title they worked on. Both of those are ways to accumulate duplicates
 * or orphans if the constraints are not exactly right.
 */

async function fixture() {
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const media = await prisma.media.create({
		data: { kind: 'movie', title: `Credit fixture ${tag}` },
	})
	const person = await prisma.person.create({
		data: {
			name: `Fixture Person ${tag}`,
			normalized: `fixture person ${tag}`,
			externalIds: { create: { provider: 'tmdb', externalId: `p-${tag}` } },
		},
	})
	return { media, person, tag }
}

function credit(
	mediaId: string,
	personId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		mediaId,
		personId,
		creditType: 'crew',
		role: 'Director',
		department: 'Directing',
		provider: 'tmdb',
		...overrides,
	}
}

test('a refresh cannot write the same credit twice', async () => {
	// This is why `role` and `department` default to the empty string rather
	// than null: NULL does not compare equal to NULL, so a nullable column in
	// this uniqueness would let every refresh insert the same crew credit again,
	// forever.
	const { media, person } = await fixture()
	await prisma.mediaCredit.create({ data: credit(media.id, person.id) })
	await expect(
		prisma.mediaCredit.create({ data: credit(media.id, person.id) }),
	).rejects.toThrow()
	expect(await prisma.mediaCredit.count({ where: { mediaId: media.id } })).toBe(
		1,
	)
})

test('the same person can hold different roles on one title', async () => {
	// Someone who wrote and directed a film has two credits on it, and a person
	// who also appears in it has a third.
	const { media, person } = await fixture()
	await prisma.mediaCredit.createMany({
		data: [
			credit(media.id, person.id, {
				role: 'Director',
				department: 'Directing',
			}),
			credit(media.id, person.id, { role: 'Writer', department: 'Writing' }),
			credit(media.id, person.id, {
				creditType: 'cast',
				role: 'Himself',
				department: '',
				billingOrder: 0,
			}),
		],
	})
	expect(await prisma.mediaCredit.count({ where: { mediaId: media.id } })).toBe(
		3,
	)
})

test('a provider identity belongs to exactly one person', async () => {
	// Identity comes from the provider's id, never the name. Without this, two
	// hydrations of the same title would each mint their own person.
	const { person, tag } = await fixture()
	const second = await prisma.person.create({
		data: { name: 'Someone Else', normalized: 'someone else' },
	})
	await expect(
		prisma.personExternalId.create({
			data: { provider: 'tmdb', externalId: `p-${tag}`, personId: second.id },
		}),
	).rejects.toThrow()

	// The same human at a different provider is the same row, not a new one.
	await prisma.personExternalId.create({
		data: { provider: 'mal', externalId: `p-${tag}`, personId: person.id },
	})
	expect(
		await prisma.personExternalId.count({ where: { personId: person.id } }),
	).toBe(2)
})

test('deleting a title takes its credits and leaves the people', async () => {
	// A person outlives any one title they worked on — that is the entire reason
	// they are their own row.
	const { media, person } = await fixture()
	await prisma.mediaCredit.create({ data: credit(media.id, person.id) })

	await prisma.media.delete({ where: { id: media.id } })
	expect(
		await prisma.mediaCredit.count({ where: { personId: person.id } }),
	).toBe(0)
	expect(
		await prisma.person.findUnique({ where: { id: person.id } }),
	).not.toBeNull()
})

test('deleting a person takes their credits and identities', async () => {
	const { media, person } = await fixture()
	await prisma.mediaCredit.create({ data: credit(media.id, person.id) })

	await prisma.person.delete({ where: { id: person.id } })
	expect(await prisma.mediaCredit.count({ where: { mediaId: media.id } })).toBe(
		0,
	)
	expect(
		await prisma.personExternalId.count({ where: { personId: person.id } }),
	).toBe(0)
	// The title is untouched.
	expect(
		await prisma.media.findUnique({ where: { id: media.id } }),
	).not.toBeNull()
})

test('cast reads back in billing order, which is what top-billed means', async () => {
	// Cast lists are ordered by the production, not alphabetically, and losing
	// that order would turn "top billed cast" into "some cast".
	const tag = faker.string.alphanumeric({ length: 8 }).toLowerCase()
	const media = await prisma.media.create({
		data: { kind: 'movie', title: `Billing fixture ${tag}` },
	})
	const people = await Promise.all(
		['Zoe Last', 'Adam First', 'Mia Middle'].map((name, index) =>
			prisma.person.create({
				data: {
					name,
					normalized: name.toLowerCase(),
					imageUrl: `/p${index}.jpg`,
				},
			}),
		),
	)
	await prisma.mediaCredit.createMany({
		data: [
			credit(media.id, people[0]!.id, {
				creditType: 'cast',
				role: 'Third',
				department: '',
				billingOrder: 2,
			}),
			credit(media.id, people[1]!.id, {
				creditType: 'cast',
				role: 'Lead',
				department: '',
				billingOrder: 0,
			}),
			credit(media.id, people[2]!.id, {
				creditType: 'cast',
				role: 'Second',
				department: '',
				billingOrder: 1,
			}),
		],
	})

	const cast = await prisma.mediaCredit.findMany({
		where: { mediaId: media.id, creditType: 'cast' },
		orderBy: [{ billingOrder: 'asc' }],
		select: { role: true },
	})
	expect(cast.map(entry => entry.role)).toEqual(['Lead', 'Second', 'Third'])
})
