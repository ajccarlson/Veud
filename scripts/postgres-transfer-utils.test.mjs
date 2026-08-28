import { expect, test } from 'vitest'
import {
	assertPostgresDatabaseUrl,
	backfillDeferredRelations,
	blankDeferred,
	buildModelTransferPlan,
	planDeferredRelations,
	containsOnlyMigrationSeededReferenceRows,
	convertSqliteRow,
	postgresTargetIdentity,
	sortRowsForSelfRelations,
} from './postgres-transfer-utils.mjs'

const scalar = (name, type, extra = {}) => ({
	name,
	type,
	kind: 'scalar',
	...extra,
})
const relation = (name, type, relationFromFields = []) => ({
	name,
	type,
	kind: 'object',
	relationFromFields,
})

test('orders models after the records referenced by their foreign keys', () => {
	const models = [
		{
			name: 'Entry',
			fields: [relation('watchlist', 'Watchlist', ['watchlistId'])],
		},
		{
			name: 'Watchlist',
			fields: [relation('owner', 'User', ['ownerId'])],
		},
		{ name: 'User', fields: [] },
	]
	expect(buildModelTransferPlan(models)).toEqual(['User', 'Watchlist', 'Entry'])
})

test('converts SQLite storage types into Prisma PostgreSQL inputs', () => {
	const model = {
		name: 'Fixture',
		fields: [
			scalar('id', 'String'),
			scalar('createdAt', 'DateTime'),
			scalar('enabled', 'Boolean'),
			scalar('position', 'Int'),
			scalar('blob', 'Bytes'),
		],
	}
	const blob = Buffer.from('veud')
	expect(
		convertSqliteRow(model, {
			id: 'fixture',
			createdAt: 1_700_000_000_000,
			enabled: 1,
			position: 4,
			blob,
		}),
	).toEqual({
		id: 'fixture',
		createdAt: new Date(1_700_000_000_000),
		enabled: true,
		position: 4,
		blob,
	})
})

test('orders self-referencing rows parent first and rejects broken references', () => {
	const model = {
		name: 'Comment',
		fields: [
			scalar('id', 'String', { isId: true }),
			scalar('parentId', 'String'),
			relation('parent', 'Comment', ['parentId']),
		],
	}
	const child = { id: 'child', parentId: 'parent' }
	const parent = { id: 'parent', parentId: null }
	expect(sortRowsForSelfRelations(model, [child, parent])).toEqual([
		parent,
		child,
	])
	expect(() =>
		sortRowsForSelfRelations(model, [{ id: 'orphan', parentId: 'missing' }]),
	).toThrow('missing row')
})

test('requires an explicit PostgreSQL transfer target', () => {
	expect(() => assertPostgresDatabaseUrl('file:./data.db')).toThrow(
		'postgresql://',
	)
	expect(() =>
		assertPostgresDatabaseUrl('postgresql://veud@localhost/veud'),
	).not.toThrow()
	expect(
		postgresTargetIdentity(
			'postgresql://veud:secret@Database.EXAMPLE:5433/veud_stage',
		),
	).toBe('database.example:5433/veud_stage')
	expect(() =>
		postgresTargetIdentity('postgresql://secret:do-not-log@['),
	).toThrow('DATABASE_URL must be a valid PostgreSQL URL')
})

test('distinguishes migration-seeded reference rows from occupied targets', () => {
	expect(
		containsOnlyMigrationSeededReferenceRows(
			new Map([
				['User', 0],
				['ListType', 3],
				['Permission', 22],
				['Role', 4],
				['_PermissionToRole', 34],
			]),
		),
	).toBe(true)
	expect(
		containsOnlyMigrationSeededReferenceRows(
			new Map([
				['ListType', 3],
				['User', 1],
			]),
		),
	).toBe(false)
	expect(
		containsOnlyMigrationSeededReferenceRows(
			new Map([
				['ListType', 0],
				['User', 0],
			]),
		),
	).toBe(false)
})

test('breaks a mutual relation cycle on its nullable side', () => {
	// A moderation report cites the action it appeals and an action cites the
	// report it came from. No insertion order satisfies both, but both foreign
	// keys are nullable, so one column can go in empty and be filled after.
	const models = [
		{
			name: 'ModerationReport',
			fields: [
				scalar('appealOfActionId', 'String', { isRequired: false }),
				relation('appealOfAction', 'ModerationAction', ['appealOfActionId']),
			],
		},
		{
			name: 'ModerationAction',
			fields: [
				scalar('reportId', 'String', { isRequired: false }),
				relation('report', 'ModerationReport', ['reportId']),
			],
		},
	]
	const deferred = planDeferredRelations(models)
	expect([...deferred.keys()]).toEqual(['ModerationAction'])
	expect([...deferred.get('ModerationAction')]).toEqual(['reportId'])
	// Deferring that column is what makes the order possible, so the model
	// holding it must now be insertable first.
	expect(buildModelTransferPlan(models, deferred)).toEqual([
		'ModerationAction',
		'ModerationReport',
	])
})

test('refuses a cycle with no nullable edge to defer', () => {
	// Nothing can be held back, so there is genuinely no insertion order. Say so
	// rather than emitting a plan that will fail against the foreign keys.
	const models = [
		{
			name: 'Left',
			fields: [
				scalar('rightId', 'String', { isRequired: true }),
				relation('right', 'Right', ['rightId']),
			],
		},
		{
			name: 'Right',
			fields: [
				scalar('leftId', 'String', { isRequired: true }),
				relation('left', 'Left', ['leftId']),
			],
		},
	]
	expect(() => planDeferredRelations(models)).toThrow(
		/Prisma model dependency cycle: Left, Right/,
	)
})

test('defers nothing when the graph is already acyclic', () => {
	const models = [
		{
			name: 'Entry',
			fields: [
				scalar('watchlistId', 'String', { isRequired: true }),
				relation('watchlist', 'Watchlist', ['watchlistId']),
			],
		},
		{ name: 'Watchlist', fields: [] },
	]
	expect([...planDeferredRelations(models).keys()]).toEqual([])
})

test('treats an undescribed foreign key column as required', () => {
	// A relation whose backing scalar is not in the model cannot be shown to be
	// nullable. Deferring it would produce a plan that fails at insert time, so
	// the cycle is reported instead.
	const models = [
		{ name: 'Left', fields: [relation('right', 'Right', ['rightId'])] },
		{ name: 'Right', fields: [relation('left', 'Left', ['leftId'])] },
	]
	expect(() => planDeferredRelations(models)).toThrow(
		/Prisma model dependency cycle/,
	)
})

test('the real datamodel produces a usable transfer plan', async () => {
	// This is the regression that matters: the cutover path could not run at
	// all, because the moderation models form a cycle the planner refused.
	const { Prisma } = await import('@prisma/client')
	const models = Prisma.dmmf.datamodel.models
	const plan = buildModelTransferPlan(models)
	expect(plan).toHaveLength(models.length)
	expect(plan).toContain('ModerationReport')
	expect(plan).toContain('ModerationAction')
})

test('blanks only the deferred columns, leaving the rest of the row alone', () => {
	const row = { id: 'a', reportId: 'r1', actorId: 'u1', reason: 'spam' }
	expect(blankDeferred({ ...row }, new Set(['reportId']))).toEqual({
		id: 'a',
		reportId: null,
		actorId: 'u1',
		reason: 'spam',
	})
	// No deferrals means the row is passed through untouched, not copied blank.
	expect(blankDeferred({ ...row }, undefined)).toEqual(row)
	expect(blankDeferred({ ...row }, new Set())).toEqual(row)
})

test('blanking ignores a deferred column the row does not carry', () => {
	// createMany rejects an unknown key, so an absent column must stay absent
	// rather than being introduced as an explicit null.
	expect(blankDeferred({ id: 'a' }, new Set(['reportId']))).toEqual({ id: 'a' })
})

function fakeSource(rows) {
	return {
		statements: [],
		prepare(sql) {
			this.statements.push(sql.replace(/\s+/g, ' ').trim())
			return {
				get: () => ({ count: rows.length }),
				all: (limit, offset) => rows.slice(offset, offset + limit),
			}
		},
	}
}

const moderationAction = {
	name: 'ModerationAction',
	fields: [
		scalar('id', 'String', { isId: true }),
		scalar('reportId', 'String', { isRequired: false }),
	],
}

test('fills the deferred column from the snapshot after every row exists', async () => {
	const updates = []
	const source = fakeSource([
		{ id: 'a1', reportId: 'r1' },
		{ id: 'a2', reportId: 'r2' },
	])
	const result = await backfillDeferredRelations({
		client: {},
		source,
		model: moderationAction,
		columns: new Set(['reportId']),
		batchSize: 1,
		delegateFor: () => ({
			updateMany: input => {
				updates.push(input)
				return { count: 1 }
			},
		}),
		onProgress() {},
	})

	expect(result).toEqual({ total: 2, updated: 2 })
	expect(updates).toEqual([
		{ where: { id: 'a1' }, data: { reportId: 'r1' } },
		{ where: { id: 'a2' }, data: { reportId: 'r2' } },
	])
	// Only the rows that actually carry a value are read back, so a table whose
	// deferred column is empty everywhere costs one count query.
	expect(
		source.statements.some(sql => sql.includes('"reportId" IS NOT NULL')),
	).toBe(true)
})

test('a deferred column that is empty everywhere fills nothing', async () => {
	const result = await backfillDeferredRelations({
		client: {},
		source: fakeSource([]),
		model: moderationAction,
		columns: new Set(['reportId']),
		batchSize: 100,
		delegateFor: () => ({
			updateMany: () => {
				throw new Error('must not update when there is nothing to fill')
			},
		}),
		onProgress() {},
	})
	expect(result).toEqual({ total: 0, updated: 0 })
})

test('refuses to back-fill a model with no primary key to match on', async () => {
	await expect(
		backfillDeferredRelations({
			client: {},
			source: fakeSource([{ reportId: 'r1' }]),
			model: { name: 'Keyless', fields: [scalar('reportId', 'String')] },
			columns: new Set(['reportId']),
			batchSize: 10,
			delegateFor: () => ({ updateMany: () => ({ count: 0 }) }),
			onProgress() {},
		}),
	).rejects.toThrow(/Keyless has deferred relations but no primary key/)
})
