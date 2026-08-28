import { z } from 'zod'
import { prisma } from './db.server.ts'
import {
	getPublicSurfaceFragment,
	type PublicSurfaceCacheRuntime,
} from './public-surface-cache.server.ts'
import { type Timings } from './timing.server.ts'

export const ROOT_LIST_TYPES_TTL_MS = 5 * 60 * 1_000
const ROOT_LIST_TYPES_KEY_VERSION = 1
const ROOT_LIST_TYPE_LIMIT = 16

const rootListTypeSchema = z
	.object({
		id: z.string().trim().min(1).max(128),
		name: z.string().trim().min(1).max(128),
		header: z.string().trim().min(1).max(256),
	})
	.strict()

const rootListTypesSchema = z
	.array(rootListTypeSchema)
	.max(ROOT_LIST_TYPE_LIMIT)
	.superRefine((listTypes, context) => {
		const ids = new Set<string>()
		const names = new Set<string>()
		for (const [index, listType] of listTypes.entries()) {
			if (ids.has(listType.id) || names.has(listType.name)) {
				context.addIssue({
					code: 'custom',
					message: 'Root list types must have unique identifiers and names.',
					path: [index],
				})
			}
			ids.add(listType.id)
			names.add(listType.name)
		}
		const sorted = [...listTypes].sort(compareRootListTypes)
		if (
			sorted.some((listType, index) => listType.id !== listTypes[index]?.id)
		) {
			context.addIssue({
				code: 'custom',
				message: 'Root list types must use canonical navigation order.',
			})
		}
	})

export type RootListType = z.infer<typeof rootListTypeSchema>

export function parseRootListTypes(value: unknown): RootListType[] {
	return rootListTypesSchema.parse(value)
}

const listTypeOrder = new Map([
	['liveaction', 0],
	['anime', 1],
	['manga', 2],
])

function compareRootListTypes(first: RootListType, second: RootListType) {
	return (
		(listTypeOrder.get(first.name) ?? Number.MAX_SAFE_INTEGER) -
			(listTypeOrder.get(second.name) ?? Number.MAX_SAFE_INTEGER) ||
		first.header.localeCompare(second.header, 'en-US') ||
		first.id.localeCompare(second.id, 'en-US')
	)
}

async function loadRootListTypes() {
	const listTypes = await prisma.listType.findMany({
		orderBy: [{ name: 'asc' }, { id: 'asc' }],
		take: ROOT_LIST_TYPE_LIMIT + 1,
		select: { id: true, name: true, header: true },
	})
	return parseRootListTypes(listTypes.sort(compareRootListTypes))
}

export async function getRootListTypes(
	options: {
		timings?: Timings
		runtime?: PublicSurfaceCacheRuntime
	} = {},
) {
	return getPublicSurfaceFragment({
		namespace: 'root-list-types',
		keyVersion: ROOT_LIST_TYPES_KEY_VERSION,
		keyPayload: { projection: 'navigation-v1' },
		ttl: ROOT_LIST_TYPES_TTL_MS,
		parse: parseRootListTypes,
		getFreshValue: loadRootListTypes,
		timings: options.timings,
		runtime: options.runtime,
	})
}
