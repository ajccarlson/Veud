export const prismaSearchOperations = [
	'contains',
	'startsWith',
	'endsWith',
] as const

export type PrismaSearchOperation = (typeof prismaSearchOperations)[number]

type PrismaSearchFilter<Operation extends PrismaSearchOperation> = Record<
	Operation,
	string
> & {
	mode?: 'insensitive'
}

function isPostgresDatasource(databaseUrl: string | undefined) {
	if (!databaseUrl) return false
	try {
		const protocol = new URL(databaseUrl).protocol.toLowerCase()
		return protocol === 'postgres:' || protocol === 'postgresql:'
	} catch {
		return /^postgres(?:ql)?:\/\//i.test(databaseUrl)
	}
}

/**
 * Build the same case-insensitive text filter for both supported databases.
 *
 * SQLite's Prisma connector rejects `mode`, while its LIKE-backed search is
 * case-insensitive for ASCII text by default. PostgreSQL requires the explicit
 * mode so Prisma emits ILIKE. Keeping the provider branch here prevents local
 * SQLite generation and tests from receiving a PostgreSQL-only argument.
 */
export function prismaSearchFilter<Operation extends PrismaSearchOperation>(
	operation: Operation,
	value: string,
	databaseUrl = process.env.DATABASE_URL,
): PrismaSearchFilter<Operation> {
	const filter = { [operation]: value } as Record<Operation, string>
	return isPostgresDatasource(databaseUrl)
		? { ...filter, mode: 'insensitive' }
		: filter
}
