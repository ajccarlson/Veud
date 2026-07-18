/**
 * Create an imported entry and its canonical provider identity atomically.
 *
 * Importers run as plain Node scripts, so this small ESM helper mirrors the
 * application's TypeScript ensureMediaForIdentity function without coupling the
 * import command to the app build.
 */
export async function createEntryWithMediaIdentity(prisma, row, identity) {
	return prisma.$transaction(async tx => {
		const externalId = await tx.mediaExternalId.upsert({
			where: { provider_kind_externalId: identity },
			update: {},
			create: {
				...identity,
				media: { create: { kind: identity.kind } },
			},
			select: { mediaId: true },
		})

		return tx.entry.create({
			data: { ...row, mediaId: externalId.mediaId },
		})
	})
}
