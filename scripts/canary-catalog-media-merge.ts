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
import { TRUSTED_CATALOG_PROVENANCE_VERSION } from '../app/utils/media-catalog.ts'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'
import { assertSafeLoadDatabaseUrl } from './postgres-load-utils.mjs'

assertCatalogWriterRuntimeProof(process.env)

function assertSafeDatabase() {
	if (!process.argv.includes('--run')) {
		throw new Error(
			'Dry run only. Pass --run with an isolated release-gate database.',
		)
	}
	const rawUrl = process.env.DATABASE_URL
	if (!rawUrl) throw new Error('DATABASE_URL is required')
	assertSafeLoadDatabaseUrl(rawUrl)
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
					catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
				},
				{
					id: targetId,
					kind: 'anime',
					title: 'Merge canary target',
					catalogProvenanceVersion: TRUSTED_CATALOG_PROVENANCE_VERSION,
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
				evidence: JSON.stringify({ source: 'postgres-merge-canary' }),
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
