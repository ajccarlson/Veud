import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { syncTrackingStateForEntry } from '#app/utils/tracking-state.server.ts'
import { serializeUserLibraryMutation } from '#app/utils/watchlist-limits.ts'

type EntryUpdate = Prisma.EntryUpdateInput
type ConfiguredColumnType = 'date' | 'history' | 'number' | 'string'

type EntryColumnRule = {
	kind: 'entry'
	configColumn: string
	configType: ConfiguredColumnType
	parse: (value: unknown) => EntryUpdate
}

type HistoryColumnRule = {
	kind: 'history'
	configColumn: string
	configType: 'history'
	historyField: 'finished' | 'started'
}

type ProgressColumnRule = {
	kind: 'progress'
	configColumn: 'chapters' | 'length' | 'volumes'
	configType: 'string'
	unit: 'chapter' | 'episode' | 'volume'
}

type CellColumnRule = EntryColumnRule | HistoryColumnRule | ProgressColumnRule

const listTypeColumnsSchema = z.record(z.string(), z.string())
const mediaTypesSchema = z
	.array(z.string().trim().min(1).max(50))
	.min(1)
	.max(10)

function emptyToNull(value: unknown) {
	return typeof value === 'string' && value.trim() === '' ? null : value
}

const finiteNumberSchema = z.union([
	z.number().refine(Number.isFinite),
	z
		.string()
		.trim()
		.regex(/^-?(?:\d+\.?\d*|\.\d+)$/)
		.transform(Number)
		.refine(Number.isFinite),
])

const nullableNumberSchema = z.preprocess(
	emptyToNull,
	finiteNumberSchema.nullable(),
)

const categoryScoreSchema = nullableNumberSchema
	.refine(value => value === null || Number.isInteger(value), {
		message: 'Category scores must be whole numbers',
	})
	.refine(
		value => value === null || value === 0 || (value >= 1 && value <= 10),
		{
			message: 'Scores must be between 1 and 10',
		},
	)
	.transform(value => (value === 0 ? null : value))

const personalScoreSchema = nullableNumberSchema
	.refine(
		value => value === null || value === 0 || (value >= 1 && value <= 10),
		{
			message: 'Scores must be between 1 and 10',
		},
	)
	.transform(value => (value === 0 ? null : value))

function nullableStringSchema(maxLength: number) {
	return z.preprocess(emptyToNull, z.string().max(maxLength).nullable())
}

const requiredTitleSchema = z.string().trim().min(1).max(500)
const shortStringSchema = nullableStringSchema(500)
const longStringSchema = nullableStringSchema(5_000)
const thumbnailSchema = nullableStringSchema(2_048)
const prioritySchema = z.preprocess(
	emptyToNull,
	z.enum(['Low', 'Medium', 'High']).nullable(),
)

const dateSchema = z.preprocess(
	emptyToNull,
	z
		.string()
		.trim()
		.max(40)
		.regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/)
		.transform((value, context) => {
			const dateOnly = value.slice(0, 10)
			const sourceDate = new Date(
				value.length === 10 ? `${dateOnly}T00:00:00.000Z` : value,
			)
			const date = new Date(`${dateOnly}T00:00:00.000Z`)
			if (
				Number.isNaN(sourceDate.getTime()) ||
				Number.isNaN(date.getTime()) ||
				date.toISOString().slice(0, 10) !== dateOnly
			) {
				context.addIssue({
					code: 'custom',
					message: 'Invalid calendar date',
				})
				return z.NEVER
			}
			return date.toISOString()
		})
		.nullable(),
)

type EntryScalarColumn =
	| 'airYear'
	| 'authors'
	| 'character'
	| 'description'
	| 'enjoyment'
	| 'genres'
	| 'language'
	| 'notes'
	| 'performance'
	| 'personal'
	| 'presentation'
	| 'priority'
	| 'rating'
	| 'releaseEnd'
	| 'releaseStart'
	| 'serialization'
	| 'sound'
	| 'startSeason'
	| 'startYear'
	| 'story'
	| 'studios'
	| 'thumbnail'
	| 'title'
	| 'type'

function entryRule<Field extends EntryScalarColumn, Schema extends z.ZodType>(
	field: Field,
	configType: Exclude<ConfiguredColumnType, 'history'>,
	schema: Schema &
		(z.output<Schema> extends EntryUpdate[Field] ? unknown : never),
): EntryColumnRule {
	return {
		kind: 'entry',
		configColumn: field,
		configType,
		parse(value) {
			const parsed = schema.safeParse(value)
			if (!parsed.success) {
				throw new Response(parsed.error.issues[0]?.message ?? 'Invalid value', {
					status: 400,
				})
			}
			return { [field]: parsed.data } as Pick<EntryUpdate, Field>
		},
	}
}

const cellColumnRules = {
	thumbnail: entryRule('thumbnail', 'string', thumbnailSchema),
	title: entryRule('title', 'string', requiredTitleSchema),
	type: entryRule('type', 'string', shortStringSchema),
	airYear: entryRule('airYear', 'string', shortStringSchema),
	startSeason: entryRule('startSeason', 'string', shortStringSchema),
	startYear: entryRule('startYear', 'string', shortStringSchema),
	releaseStart: entryRule('releaseStart', 'date', dateSchema),
	releaseEnd: entryRule('releaseEnd', 'date', dateSchema),
	rating: entryRule('rating', 'string', shortStringSchema),
	genres: entryRule('genres', 'string', longStringSchema),
	language: entryRule('language', 'string', shortStringSchema),
	studios: entryRule('studios', 'string', longStringSchema),
	serialization: entryRule('serialization', 'string', longStringSchema),
	authors: entryRule('authors', 'string', longStringSchema),
	priority: entryRule('priority', 'string', prioritySchema),
	description: entryRule('description', 'string', longStringSchema),
	notes: entryRule('notes', 'string', longStringSchema),
	story: entryRule('story', 'number', categoryScoreSchema),
	character: entryRule('character', 'number', categoryScoreSchema),
	presentation: entryRule('presentation', 'number', categoryScoreSchema),
	sound: entryRule('sound', 'number', categoryScoreSchema),
	performance: entryRule('performance', 'number', categoryScoreSchema),
	enjoyment: entryRule('enjoyment', 'number', categoryScoreSchema),
	personal: entryRule('personal', 'number', personalScoreSchema),
	started: {
		kind: 'history',
		configColumn: 'startDate',
		configType: 'history',
		historyField: 'started',
	},
	finished: {
		kind: 'history',
		configColumn: 'finishedDate',
		configType: 'history',
		historyField: 'finished',
	},
	length: {
		kind: 'progress',
		configColumn: 'length',
		configType: 'string',
		unit: 'episode',
	},
	chapters: {
		kind: 'progress',
		configColumn: 'chapters',
		configType: 'string',
		unit: 'chapter',
	},
	volumes: {
		kind: 'progress',
		configColumn: 'volumes',
		configType: 'string',
		unit: 'volume',
	},
} satisfies Record<string, CellColumnRule>

type EditableColumn = keyof typeof cellColumnRules

function isEditableColumn(value: string): value is EditableColumn {
	return Object.hasOwn(cellColumnRules, value)
}

function recordFrom(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function parseHistory(value: string | null) {
	try {
		const parsed = recordFrom(JSON.parse(value ?? ''))
		if (parsed && Object.keys(parsed).length > 0) return parsed
	} catch {}
	return {
		added: Date.now(),
		started: null,
		finished: null,
		progress: null,
	} satisfies Record<string, unknown>
}

function ensureRecord(parent: Record<string, unknown>, key: string) {
	const existing = recordFrom(parent[key])
	if (existing) return existing
	const created: Record<string, unknown> = {}
	parent[key] = created
	return created
}

function parseProgressValue(column: ProgressColumnRule, value: unknown) {
	const pattern =
		column.unit === 'episode'
			? /^(\d+)\s*\/\s*(\d+)\s+eps?$/i
			: /^(\d+)\s*\/\s*(\d+)$/
	const parsed = z.string().trim().max(100).regex(pattern).safeParse(value)
	if (!parsed.success) {
		throw new Response(`Invalid ${column.unit} progress`, { status: 400 })
	}
	const match = pattern.exec(parsed.data)
	const current = Number(match?.[1])
	const total = Number(match?.[2])
	if (
		!Number.isSafeInteger(current) ||
		!Number.isSafeInteger(total) ||
		current < 0 ||
		total < 1 ||
		current > total ||
		total > 1_000_000
	) {
		throw new Response(`Invalid ${column.unit} progress`, { status: 400 })
	}
	return current
}

function applyProgressHistory(
	history: Record<string, unknown>,
	column: ProgressColumnRule,
	current: number,
) {
	const progress = ensureRecord(history, 'progress')
	const unitProgress =
		column.unit === 'episode' ? progress : ensureRecord(progress, column.unit)
	const event = ensureRecord(unitProgress, String(current))
	const finishDates = Array.isArray(event.finishDate) ? event.finishDate : []
	event.completed = true
	event.finishDate = [...finishDates, Date.now()]
}

async function updateEntryAndTrackingState(
	tx: Prisma.TransactionClient,
	entryId: string,
	data: EntryUpdate,
) {
	await tx.entry.update({ where: { id: entryId }, data })
	await syncTrackingStateForEntry(tx, entryId)
	return tx.entry.findUniqueOrThrow({ where: { id: entryId } })
}

export async function updateEntryCellCommand(
	ownerId: string,
	input: {
		entryId: string | null
		columnId: string | null
		value: unknown
	},
) {
	try {
		return await prisma.$transaction(async tx => {
			await serializeUserLibraryMutation(tx, ownerId)
			const entry = input.entryId
				? await tx.entry.findUnique({
						where: { id: input.entryId },
						include: {
							watchlist: {
								include: {
									type: { select: { columns: true, mediaType: true } },
								},
							},
						},
					})
				: null
			if (!entry || entry.watchlist.ownerId !== ownerId) {
				throw new Response('Not found', { status: 404 })
			}

			let rawColumns: unknown
			try {
				rawColumns = JSON.parse(entry.watchlist.type.columns)
			} catch {
				throw new Response('Invalid list type columns', { status: 500 })
			}
			const parsedColumns = listTypeColumnsSchema.safeParse(rawColumns)
			if (!parsedColumns.success) {
				throw new Response('Invalid list type columns', { status: 500 })
			}

			const colId = input.columnId
			if (!colId || !isEditableColumn(colId)) {
				throw new Response('Invalid editable column', { status: 400 })
			}
			const rule = cellColumnRules[colId]
			if (parsedColumns.data[rule.configColumn] !== rule.configType) {
				throw new Response('Invalid editable column', { status: 400 })
			}

			const history = parseHistory(entry.history)
			if (rule.kind === 'entry') {
				history.lastUpdated = Date.now()
				return updateEntryAndTrackingState(tx, entry.id, {
					...rule.parse(input.value),
					history: JSON.stringify(history),
				})
			}

			if (rule.kind === 'history') {
				const parsedDate = dateSchema.safeParse(input.value)
				if (!parsedDate.success) {
					throw new Response('Invalid history date', { status: 400 })
				}
				history[rule.historyField] = parsedDate.data
				history.lastUpdated = Date.now()
				return updateEntryAndTrackingState(tx, entry.id, {
					history: JSON.stringify(history),
				})
			}

			let rawMediaTypes: unknown
			try {
				rawMediaTypes = JSON.parse(entry.watchlist.type.mediaType)
			} catch {
				throw new Response('Invalid progress column', { status: 400 })
			}
			const parsedMediaTypes = mediaTypesSchema.safeParse(rawMediaTypes)
			if (
				!parsedMediaTypes.success ||
				!parsedMediaTypes.data.includes(rule.unit)
			) {
				throw new Response('Invalid progress column', { status: 400 })
			}
			const current = parseProgressValue(rule, input.value)
			applyProgressHistory(history, rule, current)
			history.lastUpdated = Date.now()
			return updateEntryAndTrackingState(tx, entry.id, {
				history: JSON.stringify(history),
			})
		})
	} catch (error) {
		if (error instanceof Response) throw error
		console.error('[update-cell] failed to update cell:', error)
		throw new Response('Failed to update cell', { status: 500 })
	}
}
