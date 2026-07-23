#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const usage = `Usage:
  npm run moderation:bootstrap-owner -- \\
    --username <username> \\
    --confirm-username <username> \\
    --expected-database <database> \\
    [--commit]

The command grants the moderator and community-admin roles to one existing
deployment owner. It is a dry run unless --commit is supplied. DATABASE_URL
must be PostgreSQL and its database name must exactly match --expected-database.`

function valueAfter(name: string) {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
	if (process.argv.includes('--help')) {
		console.log(usage)
		return
	}
	const username = valueAfter('--username')
	const confirmation = valueAfter('--confirm-username')
	const expectedDatabase = valueAfter('--expected-database')
	const commit = process.argv.includes('--commit')
	if (!username || !confirmation || !expectedDatabase) {
		throw new Error(usage)
	}
	if (username !== confirmation) {
		throw new Error('Username confirmation does not match.')
	}
	const rawDatabaseUrl = process.env.DATABASE_URL
	if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required.')
	const databaseUrl = new URL(rawDatabaseUrl)
	if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
		throw new Error('DATABASE_URL must point to PostgreSQL.')
	}
	const databaseName = decodeURIComponent(
		databaseUrl.pathname.replace(/^\//, ''),
	)
	if (databaseName !== expectedDatabase) {
		throw new Error(
			`Database safety check failed: expected “${expectedDatabase}”, received “${databaseName}”.`,
		)
	}

	const prisma = new PrismaClient()
	try {
		const [user, roles] = await Promise.all([
			prisma.user.findUnique({
				where: { username },
				select: {
					id: true,
					username: true,
					roles: { select: { name: true } },
				},
			}),
			prisma.role.findMany({
				where: { name: { in: ['moderator', 'community-admin'] } },
				select: { name: true },
			}),
		])
		if (!user) throw new Error(`User @${username} was not found.`)
		const availableRoles = new Set(roles.map(role => role.name))
		for (const requiredRole of ['moderator', 'community-admin']) {
			if (!availableRoles.has(requiredRole)) {
				throw new Error(
					`Required role “${requiredRole}” is missing; deploy moderation migrations first.`,
				)
			}
		}
		const currentRoles = new Set(user.roles.map(role => role.name))
		const missingRoles = ['moderator', 'community-admin'].filter(
			role => !currentRoles.has(role),
		)
		if (!missingRoles.length) {
			console.log(`@${username} already has both community owner roles.`)
			return
		}
		if (!commit) {
			console.log(
				`Dry run: would grant ${missingRoles.join(', ')} to @${username} in ${databaseName}.`,
			)
			return
		}
		await prisma.$transaction(async tx => {
			await tx.user.update({
				where: { id: user.id },
				data: {
					roles: {
						connect: missingRoles.map(name => ({ name })),
					},
				},
			})
			await tx.moderationAction.createMany({
				data: missingRoles.map(role => ({
					subjectId: user.id,
					action: 'role_bootstrap_grant',
					targetType: 'role',
					targetId: role,
					reason: 'Deployment owner authorization bootstrap.',
					previousStatus: 'unassigned',
					nextStatus: 'assigned',
				})),
			})
		})
		console.log(
			`Granted ${missingRoles.join(', ')} to @${username} in ${databaseName}.`,
		)
	} finally {
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error)
	process.exitCode = 1
})
