#!/usr/bin/env tsx
import { PrismaClient } from '@prisma/client'
import {
	applyCatalogMediaMerge,
	prepareCatalogMediaMerge,
	revertCatalogMediaMerge,
} from '../app/utils/catalog-media-merge.server.ts'
import {
	expectedCatalogMergeConfirmation,
	expectedCatalogMergeReversal,
} from '../app/utils/catalog-media-merge.ts'

function assertSafeDatabase() {
	if (!process.argv.includes('--run')) {
		throw new Error(
			'Dry run only. Pass --run with an isolated restore, verify, or drill database.',
		)
	}
	const rawUrl = process.env.DATABASE_URL
	if (!rawUrl) throw new Error('DATABASE_URL is required')
	const url = new URL(rawUrl)
	const databaseName = url.pathname.slice(1).toLowerCase()
	if (
		!['127.0.0.1', 'localhost'].includes(url.hostname) ||
		!['restore', 'verify', 'drill'].some(marker =>
			databaseName.includes(marker),
		)
	) {
		throw new Error(
			'Catalog merge canary requires a local isolated restore, verify, or drill database.',
		)
	}
}

async function main() {
	assertSafeDatabase()
	const prisma = new PrismaClient()
	const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	const actorId = `merge-canary-actor-${suffix}`
	const sourceId = `merge-canary-source-${suffix}`
	const targetId = `merge-canary-target-${suffix}`
	let issueId: string | undefined
	try {
		const actor = await prisma.user.create({
			data: {
				id: actorId,
				email: `merge-canary-${suffix}@invalid.example`,
				username: `merge-canary-${suffix}`,
			},
		})
		await prisma.media.createMany({
			data: [
				{
					id: sourceId,
					kind: 'anime',
					title: 'Merge canary source',
					description: 'Journaled source description',
				},
				{
					id: targetId,
					kind: 'anime',
					title: 'Merge canary target',
				},
			],
		})
		await prisma.mediaExternalId.create({
			data: {
				id: `merge-canary-external-${suffix}`,
				provider: 'mal',
				kind: 'anime',
				externalId: `merge-canary-${suffix}`,
				mediaId: sourceId,
			},
		})
		const issue = await prisma.catalogQualityIssue.create({
			data: {
				fingerprint: `merge-canary-${suffix}`,
				issueType: 'possible_duplicate',
				status: 'confirmed',
				severity: 'warning',
				summary: 'Synthetic PostgreSQL merge canary',
				primaryMediaId: sourceId,
				secondaryMediaId: targetId,
				reviewedAt: new Date(),
				reviewedById: actor.id,
			},
		})
		issueId = issue.id

		const prepared = await prepareCatalogMediaMerge(prisma, {
			issueId: issue.id,
			targetMediaId: targetId,
			actorId: actor.id,
		})
		if (!prepared.preflight.safe) {
			throw new Error('Synthetic merge preflight was unexpectedly blocked')
		}
		await applyCatalogMediaMerge(prisma, {
			mergeId: prepared.merge.id,
			actorId: actor.id,
			confirmation: expectedCatalogMergeConfirmation(sourceId, targetId),
		})
		const [deletedSource, movedExternalId, filledTarget] = await Promise.all([
			prisma.media.findUnique({ where: { id: sourceId } }),
			prisma.mediaExternalId.findUniqueOrThrow({
				where: { id: `merge-canary-external-${suffix}` },
				select: { mediaId: true },
			}),
			prisma.media.findUniqueOrThrow({
				where: { id: targetId },
				select: { description: true },
			}),
		])
		if (
			deletedSource ||
			movedExternalId.mediaId !== targetId ||
			filledTarget.description !== 'Journaled source description'
		) {
			throw new Error('Synthetic merge apply invariants failed')
		}

		await revertCatalogMediaMerge(prisma, {
			mergeId: prepared.merge.id,
			actorId: actor.id,
			confirmation: expectedCatalogMergeReversal(prepared.merge.id),
		})
		const [restoredSource, restoredExternalId, restoredTarget, events] =
			await Promise.all([
				prisma.media.findUnique({ where: { id: sourceId } }),
				prisma.mediaExternalId.findUniqueOrThrow({
					where: { id: `merge-canary-external-${suffix}` },
					select: { mediaId: true },
				}),
				prisma.media.findUniqueOrThrow({
					where: { id: targetId },
					select: { description: true },
				}),
				prisma.catalogMediaMergeEvent.findMany({
					where: { mergeId: prepared.merge.id },
					orderBy: { createdAt: 'asc' },
					select: { action: true },
				}),
			])
		if (
			!restoredSource ||
			restoredExternalId.mediaId !== sourceId ||
			restoredTarget.description !== null ||
			events.map(event => event.action).join(',') !== 'prepare,apply,revert'
		) {
			throw new Error('Synthetic merge reversal invariants failed')
		}
		console.log(
			'Catalog merge PostgreSQL canary passed: prepare, apply, journal, and revert.',
		)
	} finally {
		if (issueId) {
			await prisma.catalogQualityIssue.deleteMany({ where: { id: issueId } })
		}
		await prisma.media.deleteMany({
			where: { id: { in: [sourceId, targetId] } },
		})
		await prisma.user.deleteMany({ where: { id: actorId } })
		await prisma.$disconnect()
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
