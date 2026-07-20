import { expect, test } from 'vitest'
import {
	assertPostgresDatabaseUrl,
	buildModelTransferPlan,
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
})
