import { type PrismaClient } from '@prisma/client'

type UserSearchClient = Pick<PrismaClient, '$queryRaw'>

export function searchUsersByUsername(
	client: UserSearchClient,
	searchTerm: string,
) {
	const like = `%${searchTerm}%`
	return client.$queryRaw`
		SELECT "User"."id", "User"."username", "User"."name", "UserImage"."id" AS "imageId"
		FROM "User"
		LEFT JOIN "UserImage" ON "User"."id" = "UserImage"."userId"
		WHERE LOWER("User"."username") LIKE LOWER(${like})
		ORDER BY (
			SELECT "Watchlist"."updatedAt"
			FROM "Watchlist"
			WHERE "Watchlist"."ownerId" = "User"."id"
			ORDER BY "Watchlist"."updatedAt" DESC
			LIMIT 1
		) DESC NULLS LAST
		LIMIT 50
	`
}
